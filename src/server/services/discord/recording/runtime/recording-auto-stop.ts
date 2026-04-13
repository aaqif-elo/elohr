import { ChannelType } from "discord.js";
import type { Guild, VoiceChannel, VoiceState } from "discord.js";
import { getActiveSession } from "./recording-session.store";
import type {
  RecordingAutoStopReason,
  RecordingSession,
} from "./recording-types";

export const STARTER_RETURN_GRACE_PERIOD_MS = 60_000;
export const BOT_ALONE_GRACE_PERIOD_MS = 30_000;
export const NO_ACTIVITY_GRACE_PERIOD_MS = 60_000;

const INACTIVITY_CHECK_INTERVAL_MS = 5_000;

function clearTimer(timer: NodeJS.Timeout | null): null {
  if (timer) {
    clearTimeout(timer);
  }

  return null;
}

function clearIntervalTimer(timer: NodeJS.Timeout | null): null {
  if (timer) {
    clearInterval(timer);
  }

  return null;
}

function getSessionVoiceChannel(
  session: RecordingSession,
  guild: Guild,
): VoiceChannel | null {
  const channel = guild.channels.cache.get(session.channelId);
  if (!channel || channel.type !== ChannelType.GuildVoice) {
    return null;
  }

  return channel;
}

function requestAutoStop(
  session: RecordingSession,
  reason: RecordingAutoStopReason,
): void {
  if (session.isStopping || session.autoStopInProgress || !session.onAutoStop) {
    return;
  }

  session.autoStopInProgress = true;

  void session.onAutoStop(reason)
    .catch((error: unknown) => {
      console.error(
        `Failed to auto-stop recording session ${session.id}:`,
        error,
      );
    })
    .finally(() => {
      session.autoStopInProgress = false;
    });
}

function syncStarterPresenceTimeout(
  session: RecordingSession,
  voiceState: VoiceState,
): void {
  if (voiceState.id !== session.startedBy) {
    return;
  }

  if (voiceState.channelId === session.channelId) {
    session.starterAbsentTimeout = clearTimer(session.starterAbsentTimeout);
    return;
  }

  if (session.starterAbsentTimeout) {
    return;
  }

  session.starterAbsentTimeout = setTimeout(() => {
    session.starterAbsentTimeout = null;
    requestAutoStop(session, "starter-absent");
  }, STARTER_RETURN_GRACE_PERIOD_MS);
}

function syncBotAloneTimeout(session: RecordingSession, guild: Guild): void {
  const voiceChannel = getSessionVoiceChannel(session, guild);
  if (!voiceChannel) {
    session.botAloneTimeout = clearTimer(session.botAloneTimeout);
    return;
  }

  const botMemberId = guild.members.me?.id;
  const otherMemberCount = voiceChannel.members.filter(
    (member) => member.id !== botMemberId,
  ).size;

  if (otherMemberCount > 0) {
    session.botAloneTimeout = clearTimer(session.botAloneTimeout);
    return;
  }

  if (session.botAloneTimeout) {
    return;
  }

  session.botAloneTimeout = setTimeout(() => {
    session.botAloneTimeout = null;
    requestAutoStop(session, "bot-alone");
  }, BOT_ALONE_GRACE_PERIOD_MS);
}

export function initializeAutoStopMonitoring(
  session: RecordingSession,
  voiceChannel: VoiceChannel,
): void {
  session.lastVoiceActivityAt = Date.now();
  session.inactivityMonitorInterval = setInterval(() => {
    if (session.isStopping) {
      return;
    }

    const inactivityDurationMs = Date.now() - session.lastVoiceActivityAt;
    if (inactivityDurationMs < NO_ACTIVITY_GRACE_PERIOD_MS) {
      return;
    }

    requestAutoStop(session, "inactive");
  }, INACTIVITY_CHECK_INTERVAL_MS);

  syncBotAloneTimeout(session, voiceChannel.guild);
}

export function clearAutoStopMonitoring(session: RecordingSession): void {
  session.starterAbsentTimeout = clearTimer(session.starterAbsentTimeout);
  session.botAloneTimeout = clearTimer(session.botAloneTimeout);
  session.inactivityMonitorInterval = clearIntervalTimer(
    session.inactivityMonitorInterval,
  );
}

export function handleRecordingVoiceStateUpdate(
  oldState: VoiceState,
  newState: VoiceState,
): void {
  const session = getActiveSession(newState.guild.id) ?? getActiveSession(oldState.guild.id);
  if (!session || session.isStopping) {
    return;
  }

  const starterStateChanged = newState.id === session.startedBy;
  const touchesRecordingChannel =
    oldState.channelId === session.channelId ||
    newState.channelId === session.channelId;

  if (!starterStateChanged && !touchesRecordingChannel) {
    return;
  }

  if (starterStateChanged) {
    syncStarterPresenceTimeout(session, newState);
  }

  syncBotAloneTimeout(session, newState.guild);
}