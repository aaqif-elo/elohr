import type {
  ChatInputCommandInteraction,
  CacheType,
  Client,
  Message,
  VoiceChannel} from "discord.js";
import {
  ChannelType,
  GuildMember,
} from "discord.js";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ERecordingStage } from "../discord.enums";
import {
  BOT_ALONE_GRACE_PERIOD_MS,
  NO_ACTIVITY_GRACE_PERIOD_MS,
  STARTER_RETURN_GRACE_PERIOD_MS,
  getActiveSession,
  getCurrentRecordingLifecycle,
  getStatusMessage,
  hasActiveSession,
  initLiveTranscription,
  processRecording,
  startRecording,
  stopRecording,
} from "../recording";
import type { RecordingAutoStopReason } from "../recording";
import type { SummaryParticipant } from "../recording/processing/recording-processing.types";
import {
  logInteractionAckTiming,
  runInteractionResponse,
} from "./interaction-response.utils";

// Path to permissions file
const PERMISSIONS_FILE = join(process.cwd(), "recording-permissions.json");

interface RecordingPermissions {
  allowedRoles: string[];
  allowedUsers: string[];
}

interface AutomaticStopOptions {
  client: Client;
  guildId: string;
  channelId: string;
  reason: RecordingAutoStopReason;
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

function hasAdminRole(member: GuildMember): boolean {
  const adminRoleId = process.env.ADMIN_ROLE_ID;
  return Boolean(adminRoleId && member.roles.cache.has(adminRoleId));
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

  return hasAdminRole(member);
}

function isVoiceChannel(
  channel: GuildMember["voice"]["channel"],
): channel is VoiceChannel {
  return channel?.type === ChannelType.GuildVoice;
}

function getInteractionTextChannelName(
  interaction: ChatInputCommandInteraction<CacheType>,
): string | undefined {
  const channel = interaction.channel;
  if (
    !channel ||
    !channel.isTextBased() ||
    !("name" in channel) ||
    typeof channel.name !== "string"
  ) {
    return;
  }

  const channelName = channel.name.trim();
  return channelName || undefined;
}

function getRecordingCommandBlockedMessage(
  sessionId: string,
  stage: "recording" | "processing",
): string {
  return stage === "processing"
    ? `❌ Recording commands are unavailable while session \`${sessionId}\` finishes processing.`
    : `❌ Recording commands are unavailable while session \`${sessionId}\` is still active in another server.`;
}

function getRecordingAlreadyStoppingMessage(sessionId: string): string {
  return `⏹️ Recording \`${sessionId}\` is already stopping. Processing will begin shortly.`;
}

function formatDurationForMessage(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  if (minutes > 0 && seconds > 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} ${seconds} second${seconds === 1 ? "" : "s"}`;
  }

  if (minutes > 0) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }

  return `${seconds} second${seconds === 1 ? "" : "s"}`;
}

function getAutomaticStopMessage(
  reason: RecordingAutoStopReason,
  startedBy: string,
): string {
  switch (reason) {
    case "starter-absent":
      return `⚠️ Recording stopped automatically because <@${startedBy}> left the voice channel and did not return within ${formatDurationForMessage(STARTER_RETURN_GRACE_PERIOD_MS)}.`;
    case "bot-alone":
      return `⚠️ Recording stopped automatically because the bot was alone in the voice channel for ${formatDurationForMessage(BOT_ALONE_GRACE_PERIOD_MS)}.`;
    case "inactive":
      return `⚠️ Recording stopped automatically because no voice activity was detected for ${formatDurationForMessage(NO_ACTIVITY_GRACE_PERIOD_MS)}.`;
    default:
      return "⚠️ Recording stopped automatically.";
  }
}

async function sendStatusMessageToChannel(
  client: Client,
  channelId: string,
  content: string,
): Promise<Message | null> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased() || !("send" in channel)) {
    return null;
  }

  return channel.send({ content });
}

async function processStoppedRecording(
  statusMessage: Message,
  stoppedSession: NonNullable<Awaited<ReturnType<typeof stopRecording>>>,
): Promise<void> {
  try {
    await processRecording(
      stoppedSession,
      statusMessage,
      {
        onSummaryReady: async (result) => {
          if (!result.summary) {
            return;
          }

          const summaryContents = formatSummaryForDiscord(result);
          for (const summaryContent of summaryContents) {
            await statusMessage.reply({
              content: summaryContent,
            });
          }
        },
      },
    );
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
}

async function stopAndProcessRecording(
  guildId: string,
  statusMessage: Message,
  createStoppedMessage: (sessionId: string, startedBy: string) => string,
): Promise<void> {
  const stoppedSession = await stopRecording(guildId);

  if (!stoppedSession) {
    await statusMessage.edit({
      content: "❌ Failed to stop recording - session not found.",
    });
    return;
  }

  await statusMessage.edit({
    content: createStoppedMessage(stoppedSession.id, stoppedSession.startedBy),
  });

  await processStoppedRecording(statusMessage, stoppedSession);
}

async function handleAutomaticStop(
  options: AutomaticStopOptions,
): Promise<void> {
  const activeSession = getActiveSession(options.guildId);
  if (!activeSession || activeSession.isStopping) {
    return;
  }

  const statusMessage = await sendStatusMessageToChannel(
    options.client,
    options.channelId,
    `⚠️ Automatic stop triggered for recording \`${activeSession.id}\`. Finalizing recording...`,
  );

  if (!statusMessage) {
    throw new Error("Failed to send automatic recording stop status message");
  }

  await stopAndProcessRecording(
    options.guildId,
    statusMessage,
    (sessionId, startedBy) => `${getAutomaticStopMessage(options.reason, startedBy)}\n\n${getStatusMessage(ERecordingStage.STOPPED, sessionId)}`,
  );
}

/**
 * Handle the /record command
 */
export async function handleRecordingCommand(
  interaction: ChatInputCommandInteraction<CacheType>,
): Promise<void> {
  // Must be in a guild
  if (!interaction.guild || !interaction.member) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: "Ephemeral",
    });
    return;
  }

  if (!(interaction.member instanceof GuildMember)) {
    await interaction.reply({
      content: "❌ Failed to resolve your server membership for this command.",
      flags: "Ephemeral",
    });
    return;
  }

  const member = interaction.member;

  // Check permissions
  if (!hasPermission(member)) {
    await interaction.reply({
      content:
        "❌ You don't have permission to use recording commands. Contact an admin to be added to the allowed list.",
      flags: "Ephemeral",
    });
    return;
  }

  const activeSession = interaction.guildId
    ? getActiveSession(interaction.guildId)
    : undefined;
  if (activeSession?.isStopping) {
    await interaction.reply({
      content: getRecordingAlreadyStoppingMessage(activeSession.id),
      flags: "Ephemeral",
    });
    return;
  }

  const currentRecordingLifecycle = getCurrentRecordingLifecycle();
  if (
    interaction.guildId &&
    currentRecordingLifecycle &&
    (
      currentRecordingLifecycle.stage === "processing" ||
      currentRecordingLifecycle.guildId !== interaction.guildId
    )
  ) {
    await interaction.reply({
      content: getRecordingCommandBlockedMessage(
        currentRecordingLifecycle.sessionId,
        currentRecordingLifecycle.stage,
      ),
      flags: "Ephemeral",
    });
    return;
  }

  if (activeSession) {
    await handleStopRecording(interaction, member);
    return;
  }

  await handleStartRecording(interaction, member);
}

/**
 * Handle /record when no recording is active
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
  if (!isVoiceChannel(voiceChannel)) {
    await interaction.reply({
      content: "❌ Recording is only supported in regular voice channels.",
      flags: "Ephemeral",
    });
    return;
  }

  // Defer reply since joining might take a moment
  logInteractionAckTiming(interaction, {
    phase: "record-start-deferReply",
    subcommand: "start",
  });
  const deferReplyResult = await runInteractionResponse(
    interaction,
    () => interaction.deferReply(),
    {
      phase: "record-start-deferReply",
      subcommand: "start",
    },
  );
  if (!deferReplyResult.ok) {
    return;
  }

  try {
    // Start recording
    const session = await startRecording(
      voiceChannel,
      member.id,
      {
        textChannelName: getInteractionTextChannelName(interaction),
        onAutoStop: async (reason) => {
          await handleAutomaticStop({
            client: interaction.client,
            guildId,
            channelId: interaction.channelId,
            reason,
          });
        },
      },
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
 * Handle /record toggle when a recording is already active
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
  const isAdmin = hasAdminRole(member);
  const isStarter = session?.startedBy === member.id;

  if (!isStarter && !isAdmin) {
    await interaction.reply({
      content: `❌ Only <@${session?.startedBy}> or an admin can stop this recording.`,
      flags: "Ephemeral",
    });
    return;
  }

  // Defer reply since processing will take time
  logInteractionAckTiming(interaction, {
    phase: "record-stop-deferReply",
    subcommand: "stop",
  });
  const deferReplyResult = await runInteractionResponse(
    interaction,
    () => interaction.deferReply(),
    {
      phase: "record-stop-deferReply",
      subcommand: "stop",
    },
  );
  if (!deferReplyResult.ok) {
    return;
  }

  try {
    const statusMessage = await interaction.editReply({
      content: "⏹️ Stopping recording...",
    });

    await stopAndProcessRecording(
      guildId,
      statusMessage,
      (sessionId) => getStatusMessage(ERecordingStage.STOPPED, sessionId),
    );
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
