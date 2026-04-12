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
  initLiveTranscription,
  queueRecordingForProcessing,
  startRecording,
  stopRecording,
} from "../recording";
import type { SummaryParticipant } from "../recording/processing/recording-processing.types";

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

    // Begin transcribing snippets as they are produced
    initLiveTranscription(session);

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
        const summaryContents = formatSummaryForDiscord(result);
        for (const summaryContent of summaryContents) {
          await interaction.followUp({
            content: summaryContent,
          });
        }
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
const DISCORD_MESSAGE_LIMIT = 2000;

function splitTextForDiscord(text: string, maxLength: number): string[] {
  if (!text.trim()) {
    return [];
  }

  const lines = text.split("\n");
  const chunks: string[] = [];
  let currentChunk = "";

  const flushChunk = () => {
    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = "";
    }
  };

  const appendSegment = (segment: string) => {
    if (!segment) {
      return;
    }

    const candidate = currentChunk ? `${currentChunk}\n${segment}` : segment;
    if (candidate.length <= maxLength) {
      currentChunk = candidate;
      return;
    }

    if (currentChunk) {
      flushChunk();
    }

    if (segment.length <= maxLength) {
      currentChunk = segment;
      return;
    }

    let remaining = segment;
    while (remaining.length > maxLength) {
      let splitIndex = remaining.lastIndexOf(" ", maxLength);
      if (splitIndex <= 0) {
        splitIndex = maxLength;
      }

      const piece = remaining.slice(0, splitIndex).trimEnd();
      if (piece) {
        chunks.push(piece);
      }
      remaining = remaining.slice(splitIndex).trimStart();
    }

    currentChunk = remaining;
  };

  for (const line of lines) {
    appendSegment(line);
  }

  flushChunk();
  return chunks;
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findMentionForAssignee(
  assignee: string,
  participants: SummaryParticipant[],
): string | null {
  const normalizedAssignee = normalizeName(assignee);
  if (!normalizedAssignee || normalizedAssignee === "owner unclear") {
    return null;
  }

  const exactMatches = participants.filter(
    (participant) => normalizeName(participant.userName) === normalizedAssignee,
  );
  if (exactMatches.length === 1) {
    return `<@${exactMatches[0].discordId}>`;
  }

  if (exactMatches.length > 1) {
    return null;
  }

  const partialMatches = participants.filter((participant) => {
    const normalizedParticipantName = normalizeName(participant.userName);
    return normalizedParticipantName.includes(normalizedAssignee);
  });

  if (partialMatches.length === 1) {
    return `<@${partialMatches[0].discordId}>`;
  }

  return null;
}

function mentionActionItemAssignees(
  summary: string,
  participants: SummaryParticipant[],
): string {
  if (participants.length === 0) {
    return summary;
  }

  const lines = summary.split("\n");
  let inActionItems = false;

  return lines
    .map((line) => {
      const trimmedLine = line.trim();
      if (trimmedLine === "## Action Items") {
        inActionItems = true;
        return line;
      }

      if (trimmedLine.startsWith("## ") && trimmedLine !== "## Action Items") {
        inActionItems = false;
        return line;
      }

      if (!inActionItems) {
        return line;
      }

      const actionItemMatch = line.match(/^(\s*-\s*)([^:]+)(:\s+.*)$/);
      if (!actionItemMatch) {
        return line;
      }

      const mention = findMentionForAssignee(actionItemMatch[2].trim(), participants);
      if (!mention) {
        return line;
      }

      return `${actionItemMatch[1]}${mention}${actionItemMatch[3]}`;
    })
    .join("\n");
}

function formatSummaryForDiscord(result: {
  sessionId: string;
  summaryTitle: string | null;
  summary: string | null;
  userCount: number;
  duration: number;
  summaryParticipants: SummaryParticipant[];
}): string[] {
  const durationMins = Math.floor(result.duration / 60);
  const durationSecs = result.duration % 60;
  const durationStr =
    durationMins > 0 ? `${durationMins}m ${durationSecs}s` : `${durationSecs}s`;

  const header = [
    "## 📋 Recording Summary",
    result.summaryTitle?.trim()
      ? `**Title:** ${result.summaryTitle.trim()}`
      : null,
    `**Session:** \`${result.sessionId}\``,
    `**Duration:** ${durationStr}`,
    `**Participants:** ${result.userCount}`,
    "",
    "---",
    "",
  ].filter((line): line is string => Boolean(line)).join("\n");

  const summaryBody = mentionActionItemAssignees(
    result.summary?.trim() || "*No summary available*",
    result.summaryParticipants,
  );
  const singleMessage = `${header}${summaryBody}`;
  if (singleMessage.length <= DISCORD_MESSAGE_LIMIT) {
    return [singleMessage];
  }

  const continuationHeader = "## 📋 Recording Summary (continued)\n\n";
  const firstChunkLimit = DISCORD_MESSAGE_LIMIT - header.length;
  const continuationChunkLimit = DISCORD_MESSAGE_LIMIT - continuationHeader.length;
  const summaryChunks = splitTextForDiscord(
    summaryBody,
    Math.max(Math.min(firstChunkLimit, continuationChunkLimit), 1),
  );

  if (summaryChunks.length === 0) {
    return [header.trimEnd()];
  }

  const messages: string[] = [];
  let firstBody = "";
  let index = 0;

  while (index < summaryChunks.length) {
    const chunk = summaryChunks[index];
    const candidate = firstBody ? `${firstBody}\n${chunk}` : chunk;
    if (candidate.length > firstChunkLimit) {
      break;
    }

    firstBody = candidate;
    index++;
  }

  if (!firstBody) {
    firstBody = summaryChunks[index];
    index++;
  }

  messages.push(`${header}${firstBody}`);

  let continuationBody = "";
  while (index < summaryChunks.length) {
    const chunk = summaryChunks[index];
    const candidate = continuationBody ? `${continuationBody}\n${chunk}` : chunk;
    if (candidate.length > continuationChunkLimit) {
      messages.push(`${continuationHeader}${continuationBody}`);
      continuationBody = chunk;
      index++;
      continue;
    }

    continuationBody = candidate;
    index++;
  }

  if (continuationBody) {
    messages.push(`${continuationHeader}${continuationBody}`);
  }

  return messages;
}
