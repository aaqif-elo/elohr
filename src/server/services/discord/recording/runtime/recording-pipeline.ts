import { EndBehaviorType } from "@discordjs/voice";
import type { VoiceReceiver } from "@discordjs/voice";
import { createWriteStream, existsSync, mkdirSync } from "fs";
import { join } from "path";
import * as prism from "prism-media";
import {
  CHANNELS,
  EXPECTED_PCM_FRAME_SIZE,
  SAMPLE_RATE,
} from "../shared/audio-format";
import { OggOpusWriter } from "../shared/ogg-opus-writer";
import {
  getExpectedPacketDurationMs,
  isExpectedPcmFrameSize,
  parseOpusToc,
} from "../shared/opus.utils";
import {
  DEBUG_AUDIO,
  MIN_SUCCESSFUL_DECODES_FOR_SYNC,
} from "./recording-config";
import {
  clearBackpressure,
  createPacketPrefixHex,
  getUserAudioTimestampMs,
  isCorruptedFrame,
  logRecentOpusContext,
  markBackpressure,
  pushRecentOpusPacket,
  writeChunkToWritable,
  writeSessionDebugLog,
} from "./recording-debug";
import {
  advanceUserAudioCursor,
  clearSnippetFinalizeTimeout,
  consumePendingGapPaddingMs,
  createConcealmentFrame,
  scheduleSnippetFinalization,
  writeSilencePadding,
  writeSilencePaddingToUserTimeline,
  writeUserAudioChunk,
} from "./recording-output";
import { createOpusSyncFilter } from "./recording-opus";
import type {
  AudioDebugStats,
  OpusPacketDebugInfo,
  RecordingSession,
  UserAudioState,
} from "./recording-types";

function createAudioDebugStats(): AudioDebugStats {
  return {
    opusPacketsReceived: 0,
    opusBytesReceived: 0,
    opusPacketsSkipped: 0,
    pcmFramesDecoded: 0,
    pcmBytesDecoded: 0,
    lastOpusPacketSize: 0,
    lastPcmFrameSize: 0,
    unusualPcmFrames: 0,
    silentPcmFrames: 0,
    suspiciousPcmFrames: 0,
    decodeErrors: 0,
    concealedFrames: 0,
  };
}

function createUserAudioState(
  session: RecordingSession,
  userId: string,
  receiver: VoiceReceiver,
  outputPath: string,
): UserAudioState {
  const decoder = new prism.opus.Decoder({
    rate: SAMPLE_RATE,
    channels: CHANNELS,
    frameSize: 960,
  });
  const audioStream = receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.Manual },
  });
  const outputStream = createWriteStream(outputPath, { flags: "a" });

  let oggOpusWriter: OggOpusWriter | undefined;
  if (DEBUG_AUDIO) {
    const rawOggPath = join(
      session.sessionPath,
      userId,
      `user_${userId}_raw.ogg`,
    );
    oggOpusWriter = new OggOpusWriter(createWriteStream(rawOggPath), {
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
    });
  }

  return {
    outputStream,
    decoder,
    audioStream,
    oggOpusWriter,
    isSubscribed: true,
    lastActivityTime: Date.now(),
    lastOpusReceiveTime: 0,
    lastOpusReceiveGapMs: 0,
    lastDecodedAudioTime: 0,
    lastOpusTocByte: -1,
    isDecodeSynced: false,
    consecutiveDecodeSuccesses: 0,
    opusPacketSequence: 0,
    recentOpusPackets: [],
    bytesWritten: 0,
    sessionAudioCursorMs: 0,
    debugStats: createAudioDebugStats(),
    lastGoodPcmFrame: null,
    expectedFrameBytes: EXPECTED_PCM_FRAME_SIZE,
    outputBackpressure: { active: false, totalEvents: 0 },
    snippetBackpressure: { active: false, totalEvents: 0 },
    decoderBackpressure: { active: false, totalEvents: 0 },
    pendingSnippetStart: false,
    snippetFinalizeTimeout: null,
    snippetFinalizePromise: null,
  };
}

function pushOpusDebugContext(
  session: RecordingSession,
  state: UserAudioState,
  opusPacket: Buffer,
): void {
  state.opusPacketSequence++;
  const tocByte = opusPacket.length > 0 ? opusPacket[0] : 0;
  const tocInfo = parseOpusToc(tocByte);

  const packetInfo: OpusPacketDebugInfo = {
    sequence: state.opusPacketSequence,
    receivedAtMs: Date.now() - session.startedAt.getTime(),
    packetLengthBytes: opusPacket.length,
    tocByte,
    tocConfig: tocInfo.config,
    tocStereo: tocInfo.stereo,
    tocFrameCount: tocInfo.frameCount,
    packetPrefixHex: createPacketPrefixHex(opusPacket),
  };

  pushRecentOpusPacket(state, packetInfo);
}

function logStartupPacket(
  session: RecordingSession,
  userId: string,
  state: UserAudioState | undefined,
  debugStats: AudioDebugStats,
  opusPacket: Buffer,
): void {
  if (!DEBUG_AUDIO || debugStats.opusPacketsReceived > 3) {
    return;
  }

  const tocByte = opusPacket[0];
  const config = (tocByte >> 3) & 0x1f;
  const stereo = (tocByte >> 2) & 0x01;
  const frameCount = tocByte & 0x03;

  writeSessionDebugLog(
    session,
    "log",
    `[DEBUG] User ${userId} opus packet #${debugStats.opusPacketsReceived}: ${opusPacket.length} bytes`,
    {
      userId,
      userTrackMs: state ? getUserAudioTimestampMs(state) : 0,
    },
  );
  writeSessionDebugLog(
    session,
    "log",
    `[DEBUG]   TOC byte: 0x${tocByte.toString(16)} (config=${config}, stereo=${stereo}, frames=${frameCount})`,
    {
      userId,
      userTrackMs: state ? getUserAudioTimestampMs(state) : 0,
    },
  );
}

function subscribeToUser(
  receiver: VoiceReceiver,
  session: RecordingSession,
  userId: string,
): void {
  const existingState = session.userAudioStates.get(userId);
  if (existingState?.isSubscribed) {
    return;
  }

  console.log(`Subscribing to user ${userId} audio stream (persistent)`);

  const userDir = join(session.sessionPath, userId);
  const snippetsDir = join(userDir, "snippets");
  if (!existsSync(userDir)) {
    mkdirSync(userDir, { recursive: true });
  }
  if (!existsSync(snippetsDir)) {
    mkdirSync(snippetsDir, { recursive: true });
  }

  const outputPath = join(userDir, `user_${userId}.pcm`);
  const audioState = createUserAudioState(session, userId, receiver, outputPath);

  const currentMeetingTimeMs = Date.now() - session.startedAt.getTime();
  if (!session.userStartTimes.has(userId)) {
    session.userIds.add(userId);
    session.userStartTimes.set(userId, currentMeetingTimeMs);
    console.log(
      `User ${userId} start offset: ${currentMeetingTimeMs}ms from session start`,
    );

    if (currentMeetingTimeMs > 0) {
      const initialSilenceBytes = writeSilencePadding(
        audioState.outputStream,
        currentMeetingTimeMs,
        userId,
      );
      advanceUserAudioCursor(audioState, initialSilenceBytes);
    }
  }

  session.userAudioStates.set(userId, audioState);
  session.userStreams.set(userId, audioState.outputStream);

  audioState.outputStream.on("drain", () => {
    clearBackpressure(
      session,
      userId,
      audioState,
      "output",
      audioState.outputBackpressure,
    );
  });
  audioState.outputStream.on("close", () => {
    clearBackpressure(
      session,
      userId,
      audioState,
      "output",
      audioState.outputBackpressure,
    );
  });

  const opusSyncFilter = createOpusSyncFilter(session, userId, () => {
    audioState.debugStats.opusPacketsSkipped++;
  });
  opusSyncFilter.on("error", (error) => {
    console.error(`Opus sync filter error for user ${userId}:`, error.message);
  });

  const wireDecoderHandlers = (decoder: prism.opus.Decoder) => {
    decoder.on("drain", () => {
      const state = session.userAudioStates.get(userId);
      if (!state) {
        return;
      }

      clearBackpressure(
        session,
        userId,
        state,
        "decoder",
        state.decoderBackpressure,
      );
    });

    decoder.on("data", (pcmChunk: Buffer) => {
      const state = session.userAudioStates.get(userId);
      if (!state || session.isStopping) {
        return;
      }

      state.consecutiveDecodeSuccesses++;
      if (
        !state.isDecodeSynced &&
        state.consecutiveDecodeSuccesses >= MIN_SUCCESSFUL_DECODES_FOR_SYNC
      ) {
        state.isDecodeSynced = true;
        writeSessionDebugLog(
          session,
          "log",
          `[DEBUG] User ${userId}: Decode sync achieved after ${state.consecutiveDecodeSuccesses} successful decodes`,
          {
            userId,
            userTrackMs: getUserAudioTimestampMs(state),
          },
        );
      }

      state.lastActivityTime = Date.now();
      state.debugStats.pcmFramesDecoded++;
      state.debugStats.pcmBytesDecoded += pcmChunk.length;
      state.debugStats.lastPcmFrameSize = pcmChunk.length;

      const tocKnown = state.lastOpusTocByte >= 0;
      const frameSizeExpected = tocKnown
        ? isExpectedPcmFrameSize(pcmChunk.length, state.lastOpusTocByte)
        : pcmChunk.length === EXPECTED_PCM_FRAME_SIZE;

      if (!frameSizeExpected) {
        state.debugStats.unusualPcmFrames++;
        if (DEBUG_AUDIO && state.debugStats.unusualPcmFrames <= 5) {
          const tocHex = tocKnown
            ? `0x${state.lastOpusTocByte.toString(16)}`
            : "unknown";
          writeSessionDebugLog(
            session,
            "log",
            `[DEBUG] User ${userId}: Unusual PCM frame size ${pcmChunk.length} bytes (TOC ${tocHex})`,
            {
              userId,
              userTrackMs: getUserAudioTimestampMs(state),
            },
          );
        }
      }

      const expectedFrameMs = getExpectedPacketDurationMs(
        state.lastOpusTocByte,
        pcmChunk.length,
      );
      const gapPaddingMs = consumePendingGapPaddingMs(state, expectedFrameMs);
      if (gapPaddingMs > 0) {
        const writtenSilenceBytes = writeSilencePaddingToUserTimeline(
          session,
          userId,
          state,
          gapPaddingMs,
        );

        if (DEBUG_AUDIO && writtenSilenceBytes > 0) {
          writeSessionDebugLog(
            session,
            "log",
            `[DEBUG] User ${userId}: Inserted ${writtenSilenceBytes} bytes of capped silence padding (${gapPaddingMs.toFixed(1)}ms)`,
            {
              userId,
              userTrackMs: getUserAudioTimestampMs(state),
            },
          );
        }
      }

      if (isCorruptedFrame(pcmChunk)) {
        state.debugStats.suspiciousPcmFrames++;
        if (DEBUG_AUDIO && state.debugStats.suspiciousPcmFrames <= 10) {
          const hexDump = pcmChunk
            .subarray(0, 32)
            .toString("hex")
            .match(/.{1,4}/g)
            ?.join(" ");
          writeSessionDebugLog(
            session,
            "warn",
            `[DEBUG] User ${userId}: Corrupted PCM frame #${state.debugStats.pcmFramesDecoded}, hex: ${hexDump}`,
            {
              userId,
              userTrackMs: getUserAudioTimestampMs(state),
            },
          );
          logRecentOpusContext(
            session,
            userId,
            state,
            `Corrupted PCM frame #${state.debugStats.pcmFramesDecoded}`,
          );
        }

        writeUserAudioChunk(
          session,
          userId,
          state,
          Buffer.alloc(pcmChunk.length, 0),
        );
        return;
      }

      let isSilent = true;
      for (let index = 0; index < Math.min(64, pcmChunk.length); index++) {
        if (pcmChunk[index] !== 0) {
          isSilent = false;
          break;
        }
      }
      if (isSilent) {
        state.debugStats.silentPcmFrames++;
      }

      writeUserAudioChunk(session, userId, state, pcmChunk);
      state.lastGoodPcmFrame = Buffer.from(pcmChunk);
      state.expectedFrameBytes = pcmChunk.length;
    });

    decoder.on("error", (error) => {
      if (session.isStopping) {
        return;
      }

      audioState.debugStats.decodeErrors++;
      const state = session.userAudioStates.get(userId);
      if (state) {
        state.consecutiveDecodeSuccesses = 0;
        const concealmentFrame = createConcealmentFrame(state);
        writeUserAudioChunk(session, userId, state, concealmentFrame);
        state.debugStats.concealedFrames++;
        state.lastOpusReceiveGapMs = 0;
      }

      if (DEBUG_AUDIO && audioState.debugStats.decodeErrors <= 5) {
        writeSessionDebugLog(
          session,
          "warn",
          `[DEBUG] Opus decode error #${audioState.debugStats.decodeErrors} for user ${userId}: ${error.message} (PLC concealment written)`,
          {
            userId,
            userTrackMs: state ? getUserAudioTimestampMs(state) : 0,
          },
        );

        if (state) {
          logRecentOpusContext(
            session,
            userId,
            state,
            `Opus decode error #${audioState.debugStats.decodeErrors}`,
          );
        }
      }

      if (state && (decoder.destroyed || decoder.writableEnded)) {
        writeSessionDebugLog(
          session,
          "log",
          `[DEBUG] Decoder for user ${userId} was destroyed after error, recreating...`,
          {
            userId,
            userTrackMs: getUserAudioTimestampMs(state),
          },
        );

        try {
          const newDecoder = new prism.opus.Decoder({
            rate: SAMPLE_RATE,
            channels: CHANNELS,
            frameSize: 960,
          });
          clearBackpressure(
            session,
            userId,
            state,
            "decoder",
            state.decoderBackpressure,
          );
          state.isDecodeSynced = false;
          state.consecutiveDecodeSuccesses = 0;
          state.lastOpusTocByte = -1;
          state.lastOpusReceiveGapMs = 0;
          state.recentOpusPackets = [];
          wireDecoderHandlers(newDecoder);
          state.decoder = newDecoder;
        } catch (recreateError) {
          console.error(
            `Failed to recreate decoder for user ${userId}:`,
            recreateError instanceof Error
              ? recreateError.message
              : String(recreateError),
          );
        }
      }

      if (
        error.message.includes("Aborted") ||
        error.message.includes("Fatal") ||
        error.message.includes("assertion")
      ) {
        console.error(
          `Fatal decoder error for user ${userId}, marking for resubscription`,
        );
        audioState.isSubscribed = false;
        try {
          decoder.destroy();
        } catch {
          // ignore destroy failures during fatal recovery
        }
      }
    });
  };

  wireDecoderHandlers(audioState.decoder);

  audioState.audioStream.on("close", () => {
    console.log(`Audio stream closed for user ${userId}`);
    audioState.isSubscribed = false;
  });
  audioState.audioStream.on("error", (error) => {
    console.error(`Audio stream error for user ${userId}:`, error.message);
    audioState.isSubscribed = false;
  });
  audioState.outputStream.on("error", (error) => {
    console.error(`Output stream error for user ${userId}:`, error.message);
  });

  audioState.audioStream.on("data", (opusPacket: Buffer) => {
    if (session.isStopping) {
      return;
    }

    const state = session.userAudioStates.get(userId);
    audioState.debugStats.opusPacketsReceived++;
    audioState.debugStats.opusBytesReceived += opusPacket.length;
    audioState.debugStats.lastOpusPacketSize = opusPacket.length;

    if (state) {
      pushOpusDebugContext(session, state, opusPacket);
    }

    audioState.oggOpusWriter?.writePacket(opusPacket);
    logStartupPacket(session, userId, state, audioState.debugStats, opusPacket);
  });

  audioState.audioStream.pipe(opusSyncFilter);
  opusSyncFilter.on("data", (opusChunk: Buffer) => {
    if (session.isStopping) {
      return;
    }

    const state = session.userAudioStates.get(userId);
    if (!state) {
      return;
    }

    const receivedAt = Date.now();
    state.lastOpusReceiveGapMs =
      state.lastOpusReceiveTime === 0
        ? 0
        : receivedAt - state.lastOpusReceiveTime;
    state.lastOpusReceiveTime = receivedAt;

    if (opusChunk.length > 0) {
      state.lastOpusTocByte = opusChunk[0];
    }

    if (!state.decoder.destroyed) {
      try {
        writeChunkToWritable(state.decoder, opusChunk, () => {
          markBackpressure(
            session,
            userId,
            state,
            "decoder",
            state.decoderBackpressure,
          );
        });
      } catch {
        // decoder write failures surface through the decoder error event
      }
    }
  });
}

export function setupAudioReceiver(
  receiver: VoiceReceiver,
  session: RecordingSession,
): void {
  receiver.speaking.on("start", (userId) => {
    if (session.isStopping) {
      return;
    }

    const existingState = session.userAudioStates.get(userId);
    if (existingState) {
      clearSnippetFinalizeTimeout(existingState);
    }

    if (existingState?.isSubscribed) {
      existingState.lastActivityTime = Date.now();
      if (!existingState.currentSnippet) {
        existingState.pendingSnippetStart = true;
      }
      return;
    }

    subscribeToUser(receiver, session, userId);

    const newState = session.userAudioStates.get(userId);
    if (newState) {
      newState.lastActivityTime = Date.now();
      newState.pendingSnippetStart = true;
    }
  });

  receiver.speaking.on("end", (userId) => {
    if (session.isStopping) {
      return;
    }

    const state = session.userAudioStates.get(userId);
    if (!state) {
      return;
    }

    state.lastActivityTime = Date.now();
    scheduleSnippetFinalization(session, userId, state);

    if (DEBUG_AUDIO) {
      writeSessionDebugLog(
        session,
        "log",
        `User ${userId} stopped speaking, bytes written: ${state.bytesWritten}`,
        {
          userId,
          userTrackMs: getUserAudioTimestampMs(state),
        },
      );
    }
  });
}