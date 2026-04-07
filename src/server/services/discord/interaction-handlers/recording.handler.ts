import type {
  ChatInputCommandInteraction,
  CacheType,
  GuildMember,
  VoiceChannel} from "discord.js";
import {
  ChannelType,
} from "discord.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ERecordingStage } from "../discord.enums";
import {
  getActiveSession,
  getStatusMessage,
  hasActiveSession,
  queueRecordingForProcessing,
  startRecording,
  stopRecording,
} from "../recording";

// Path to permissions file
const PERMISSIONS_FILE = join(process.cwd(), "recording-permissions.json");

interface RecordingPermissions {
  allowedRoles: string[];
  allowedUsers: string[];
}

/**
 * Load permissions from JSON file
 */
function loadPermissions(): RecordingPermissions {
  try {
    if (existsSync(PERMISSIONS_FILE)) {
      const content = readFileSync(PERMISSIONS_FILE, "utf-8");
      return JSON.parse(content);
    }
  } catch (error) {
    console.error("Error loading recording permissions:", error);
  }
  return { allowedRoles: [], allowedUsers: [] };
}

/**
 * Check if a member has permission to use recording commands
 */
function hasPermission(member: GuildMember): boolean {
  const permissions = loadPermissions();

  // Check if user is in the allowed users list
  if (permissions.allowedUsers.includes(member.id)) {
    return true;
  }

  // Check if user has any of the allowed roles
  for (const roleId of permissions.allowedRoles) {
    if (member.roles.cache.has(roleId)) {
      return true;
    }
  }

  // Check for admin role from environment
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  if (adminRoleId && member.roles.cache.has(adminRoleId)) {
    return true;
  }

  return false;
}

/**
 * Handle the /record command
 */
export async function handleRecordingCommand(
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  // Must be in a guild
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: "Ephemeral",
    });
    return;
  }

  const member = interaction.member as GuildMember;

  // Check permissions
  if (!hasPermission(member)) {
    await interaction.reply({
      content:
        "❌ You don't have permission to use recording commands. Contact an admin to be added to the allowed list.",
      flags: "Ephemeral",
    });
    return;
  }

  if (subcommand === "start") {
    await handleStartRecording(interaction, member);
  } else if (subcommand === "stop") {
    await handleStopRecording(interaction, member);
  }
}

/**
 * Handle /record start
 */
async function handleStartRecording(
  interaction: ChatInputCommandInteraction<CacheType>,
  member: GuildMember,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "❌ This command must be used in a server.", flags: "Ephemeral" });
    return;
  }
  const guildId = interaction.guildId;

  // Check if already recording
  if (hasActiveSession(guildId)) {
    const session = getActiveSession(guildId);
    await interaction.reply({
      content: `❌ Already recording in this server!\nSession: \`${session?.id}\`\nStarted by: <@${session?.startedBy}>`,
      flags: "Ephemeral",
    });
    return;
  }

  // User must be in a voice channel
  const voiceChannel = member.voice.channel;
  if (!voiceChannel) {
    await interaction.reply({
      content: "❌ You must be in a voice channel to start recording.",
      flags: "Ephemeral",
    });
    return;
  }

  // Must be a regular voice channel (not stage)
  if (voiceChannel.type !== ChannelType.GuildVoice) {
    await interaction.reply({
      content: "❌ Recording is only supported in regular voice channels.",
      flags: "Ephemeral",
    });
    return;
  }

  // Defer reply since joining might take a moment
  await interaction.deferReply();

  try {
    // Start recording
    const session = await startRecording(
      voiceChannel as VoiceChannel,
      member.id,
    );

    // Send status message
    await interaction.editReply({
      content: getStatusMessage(ERecordingStage.STARTED, session.id),
    });

    // Notify the voice channel
    const textChannel = interaction.channel;
    if (textChannel && textChannel.isTextBased()) {
      // Only send to the channel if it's different from where the command was run
      // (otherwise the status message already serves as notification)
    }
  } catch (error) {
    console.error("Error starting recording:", error);
    await interaction.editReply({
      content: `❌ Failed to start recording: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

/**
 * Handle /record stop
 */
async function handleStopRecording(
  interaction: ChatInputCommandInteraction<CacheType>,
  member: GuildMember,
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({ content: "❌ This command must be used in a server.", flags: "Ephemeral" });
    return;
  }
  const guildId = interaction.guildId;

  // Check if recording is active
  if (!hasActiveSession(guildId)) {
    await interaction.reply({
      content: "❌ No active recording in this server.",
      flags: "Ephemeral",
    });
    return;
  }

  const session = getActiveSession(guildId);

  // Only the person who started or admins can stop
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  const isAdmin = adminRoleId && member.roles.cache.has(adminRoleId);
  const isStarter = session?.startedBy === member.id;

  if (!isStarter && !isAdmin) {
    await interaction.reply({
      content: `❌ Only <@${session?.startedBy}> or an admin can stop this recording.`,
      flags: "Ephemeral",
    });
    return;
  }

  // Defer reply since processing will take time
  await interaction.deferReply();

  try {
    // Stop recording
    const stoppedSession = await stopRecording(guildId);

    if (!stoppedSession) {
      await interaction.editReply({
        content: "❌ Failed to stop recording - session not found.",
      });
      return;
    }

    // Update status to stopped/queued
    const statusMessage = await interaction.editReply({
      content: getStatusMessage(ERecordingStage.STOPPED, stoppedSession.id),
    });

    // Queue for processing
    try {
      const result = await queueRecordingForProcessing(
        stoppedSession,
        statusMessage,
      );

      // Post the summary
      if (result.summary) {
        const summaryContent = formatSummaryForDiscord(result);
        await interaction.followUp({
          content: summaryContent,
        });
      }
    } catch (error) {
      console.error("Error processing recording:", error);
      await statusMessage.edit({
        content: getStatusMessage(
          ERecordingStage.ERROR,
          stoppedSession.id,
          error instanceof Error ? error.message : "Processing failed",
        ),
      });
    }
  } catch (error) {
    console.error("Error stopping recording:", error);
    await interaction.editReply({
      content: `❌ Failed to stop recording: ${error instanceof Error ? error.message : "Unknown error"}`,
    });
  }
}

/**
 * Format the summary for Discord
 */
function formatSummaryForDiscord(result: {
  sessionId: string;
  summary: string | null;
  userCount: number;
  duration: number;
}): string {
  const durationMins = Math.floor(result.duration / 60);
  const durationSecs = result.duration % 60;
  const durationStr =
    durationMins > 0 ? `${durationMins}m ${durationSecs}s` : `${durationSecs}s`;

  let content = `## 📋 Recording Summary\n`;
  content += `**Session:** \`${result.sessionId}\`\n`;
  content += `**Duration:** ${durationStr}\n`;
  content += `**Participants:** ${result.userCount}\n\n`;

  if (result.summary) {
    content += `---\n\n${result.summary}`;
  } else {
    content += `---\n\n*No summary available*`;
  }

  return content;
}
