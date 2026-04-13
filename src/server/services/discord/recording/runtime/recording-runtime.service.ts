import {
  VoiceConnectionStatus,
  entersState,
  joinVoiceChannel,
} from "@discordjs/voice";
import type { VoiceChannel } from "discord.js";
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync } from "fs";
import { join } from "path";
import {
  BYTES_PER_SECOND,
  EXPECTED_PCM_FRAME_SIZE,
  getTimelineByteOffset,
} from "../shared/audio-format";
import {
  clearAutoStopMonitoring,
  initializeAutoStopMonitoring,
} from "./recording-auto-stop";
import {
  DEBUG_AUDIO,
  MAX_DURATION_MINS,
  MAX_DURATION_MS,
  RECORDINGS_PATH,
} from "./recording-config";
import {
  getUserAudioTimestampMs,
  writeSessionDebugLog,
} from "./recording-debug";
import {
  writeSessionTimingMetadata,
} from "./recording-files";
import {
  finalizeCurrentSnippet,
  writeTrailingSilenceToSessionEnd,
} from "./recording-output";
import { initializeOpusDiagnostics } from "./recording-opus";
import {
  beginRecordingLifecycle,
  clearRecordingLifecycle,
  createSessionId,
  deleteActiveSession,
  getActiveSession,
  getCurrentRecordingLifecycle,
  getSessionDurationMs,
  hasActiveSession,
  setRecordingLifecycleStage,
  setActiveSession,
} from "./recording-session.store";
import { setupAudioReceiver } from "./recording-pipeline";
import type {
  RecordingAutoStopReason,
  RecordingSession,
} from "./recording-types";

initializeOpusDiagnostics();

interface StartRecordingOptions {
  textChannelName?: string;
  onAutoStop?: (reason: RecordingAutoStopReason) => Promise<void>;
}

export async function startRecording(
  voiceChannel: VoiceChannel,
  startedBy: string,
  options: StartRecordingOptions = {},
): Promise<RecordingSession> {
  const guildId = voiceChannel.guild.id;

  if (hasActiveSession(guildId)) {
    throw new Error("Already recording in this server");
  }

  const currentRecordingLifecycle = getCurrentRecordingLifecycle();
  if (currentRecordingLifecycle) {
    const lifecycleMessage =
      currentRecordingLifecycle.stage === "processing"
        ? `Recording session ${currentRecordingLifecycle.sessionId} is still processing`
        : `Recording session ${currentRecordingLifecycle.sessionId} is already active`;
    throw new Error(lifecycleMessage);
  }

  const sessionId = createSessionId();
  const sessionPath = join(RECORDINGS_PATH, sessionId);
  const debugLogPath = DEBUG_AUDIO ? join(sessionPath, "debug.log") : null;

  beginRecordingLifecycle({ guildId, id: sessionId });

  let connection: ReturnType<typeof joinVoiceChannel> | null = null;

  try {
    if (!existsSync(RECORDINGS_PATH)) {
      mkdirSync(RECORDINGS_PATH, { recursive: true });
    }
    mkdirSync(sessionPath, { recursive: true });

    connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch (error) {
      throw new Error("Failed to join voice channel within 30 seconds", {
        cause: error,
      });
    }

    const session: RecordingSession = {
      id: sessionId,
      guildId,
      channelId: voiceChannel.id,
      channelName: voiceChannel.name,
      textChannelName: options.textChannelName?.trim() || undefined,
      startedAt: new Date(),
      stoppedAt: null,
      startedBy,
      connection,
      userStreams: new Map(),
      userAudioStates: new Map(),
      userIds: new Set(),
      userStartTimes: new Map(),
      speechSegments: [],
      sessionPath,
      debugLogPath,
      debugLogStream: debugLogPath
        ? createWriteStream(debugLogPath, { flags: "a" })
        : null,
      debugMergedFd: DEBUG_AUDIO
        ? openSync(join(sessionPath, "merged_debug.pcm"), "w+")
        : null,
      lastVoiceActivityAt: Date.now(),
      maxDurationTimeout: null,
      starterAbsentTimeout: null,
      botAloneTimeout: null,
      inactivityMonitorInterval: null,
      receiver: connection.receiver,
      isStopping: false,
      autoStopInProgress: false,
      onAutoStop: options.onAutoStop,
    };

    setupAudioReceiver(connection.receiver, session);

    session.maxDurationTimeout = setTimeout(() => {
      console.log(
        `Recording ${sessionId} reached max duration of ${MAX_DURATION_MINS} minutes`,
      );
    }, MAX_DURATION_MS);

    setActiveSession(session);
    initializeAutoStopMonitoring(session, voiceChannel);

    if (DEBUG_AUDIO && session.debugLogPath) {
      writeSessionDebugLog(
        session,
        "log",
        `[DEBUG] Session debug logging started at ${session.debugLogPath}`,
      );
    }

    console.log(`Started recording session ${sessionId} in ${voiceChannel.name}`);
    return session;
  } catch (error) {
    connection?.destroy();
    clearRecordingLifecycle(sessionId);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function stopRecording(
  guildId: string,
): Promise<RecordingSession | null> {
  const session = getActiveSession(guildId);
  if (!session) {
    return null;
  }

  if (session.isStopping) {
    throw new Error("Recording is already stopping");
  }

  session.isStopping = true;
  session.stoppedAt = new Date();
  clearAutoStopMonitoring(session);

  const sessionDurationMs = getSessionDurationMs(session);
  const targetTrackByteLength = getTimelineByteOffset(sessionDurationMs);

  if (session.maxDurationTimeout) {
    clearTimeout(session.maxDurationTimeout);
    session.maxDurationTimeout = null;
  }

  const snippetFinalizePromises = Array.from(session.userAudioStates.entries()).map(
    ([userId, state]) => finalizeCurrentSnippet(session, userId, state),
  );
  await Promise.all(snippetFinalizePromises);

  for (const [userId, state] of session.userAudioStates) {
    const trailingSilenceBytes = writeTrailingSilenceToSessionEnd(
      session,
      userId,
      state,
      targetTrackByteLength,
    );

    if (DEBUG_AUDIO && trailingSilenceBytes > 0) {
      writeSessionDebugLog(
        session,
        "log",
        `[DEBUG] User ${userId}: padded ${trailingSilenceBytes} trailing silence bytes to reach the session stop time`,
        {
          userId,
          userTrackMs: getUserAudioTimestampMs(state),
          sessionAudioMs: sessionDurationMs,
        },
      );
    }
  }

  console.log(`Recording session ${session.id} statistics:`);
  for (const [userId, state] of session.userAudioStates) {
    const durationSecs = state.bytesWritten / BYTES_PER_SECOND;
    console.log(
      `  User ${userId}: ${state.bytesWritten} bytes (~${durationSecs.toFixed(1)}s of audio)`,
    );

    if (DEBUG_AUDIO) {
      const stats = state.debugStats;
      writeSessionDebugLog(
        session,
        "log",
        `    [DEBUG] Opus: ${stats.opusPacketsReceived} packets (${stats.opusBytesReceived} bytes), ${stats.opusPacketsSkipped} skipped, ${stats.decodeErrors} decode errors`,
        {
          userId,
          userTrackMs: getUserAudioTimestampMs(state),
        },
      );
      writeSessionDebugLog(
        session,
        "log",
        `    [DEBUG] PCM: ${stats.pcmFramesDecoded} frames (${stats.pcmBytesDecoded} bytes)`,
        {
          userId,
          userTrackMs: getUserAudioTimestampMs(state),
        },
      );
      writeSessionDebugLog(
        session,
        "log",
        `    [DEBUG] Issues: ${stats.unusualPcmFrames} unusual, ${stats.silentPcmFrames} silent, ${stats.suspiciousPcmFrames} suspicious, ${stats.concealedFrames} PLC-concealed frames`,
        {
          userId,
          userTrackMs: getUserAudioTimestampMs(state),
        },
      );
      writeSessionDebugLog(
        session,
        "log",
        `    [DEBUG] Backpressure: output=${state.outputBackpressure.totalEvents}, snippet=${state.snippetBackpressure.totalEvents}, decoder=${state.decoderBackpressure.totalEvents}`,
        {
          userId,
          userTrackMs: getUserAudioTimestampMs(state),
        },
      );

      const validPackets = stats.opusPacketsReceived - stats.opusPacketsSkipped;
      const expectedPcmBytes = validPackets * EXPECTED_PCM_FRAME_SIZE;
      const pctOfExpected =
        expectedPcmBytes > 0
          ? ((stats.pcmBytesDecoded / expectedPcmBytes) * 100).toFixed(1)
          : "N/A";
      writeSessionDebugLog(
        session,
        "log",
        `    [DEBUG] Expected PCM: ${expectedPcmBytes} bytes, Got: ${stats.pcmBytesDecoded} (${pctOfExpected}%)`,
        {
          userId,
          userTrackMs: getUserAudioTimestampMs(state),
        },
      );

      if (stats.opusPacketsSkipped > 0) {
        writeSessionDebugLog(
          session,
          "log",
          `    [DEBUG] Skipped ${stats.opusPacketsSkipped} empty startup packets`,
          {
            userId,
            userTrackMs: getUserAudioTimestampMs(state),
          },
        );
      }

      if (stats.decodeErrors > 0) {
        const errorRate = (
          (stats.decodeErrors / stats.opusPacketsReceived) *
          100
        ).toFixed(1);
        writeSessionDebugLog(
          session,
          "warn",
          `    [DEBUG] Decode error rate: ${errorRate}% (${stats.decodeErrors}/${stats.opusPacketsReceived} packets)`,
          {
            userId,
            userTrackMs: getUserAudioTimestampMs(state),
          },
        );
      }
    }
  }

  const closePromises = Array.from(session.userAudioStates.entries()).map(
    ([userId, state]) =>
      new Promise<void>((resolve) => {
        try {
          state.audioStream.destroy();
          state.decoder.destroy();
          state.oggOpusWriter?.close();
          state.outputStream.end(() => resolve());
        } catch (error) {
          console.error(`Error closing stream for user ${userId}:`, error);
          resolve();
        }
      }),
  );
  await Promise.all(closePromises);

  writeSessionTimingMetadata(session);

  if (session.debugMergedFd !== null) {
    try {
      closeSync(session.debugMergedFd);
    } catch (error) {
      console.error(
        "Failed to close debug merged PCM fd:",
        error instanceof Error ? error.message : String(error),
      );
    }
    session.debugMergedFd = null;
  }

  if (session.debugLogStream) {
    await new Promise<void>((resolve) => {
      session.debugLogStream?.end(() => resolve());
    });
    session.debugLogStream = null;
  }

  session.userStreams.clear();
  session.userAudioStates.clear();
  session.connection.destroy();
  deleteActiveSession(guildId);
  setRecordingLifecycleStage(session.id, "processing");

  console.log(`Stopped recording session ${session.id}`);
  return session;
}