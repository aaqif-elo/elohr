import {
  createWriteStream,
  existsSync,
  readFileSync,
  readSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "fs";
import { join } from "path";
import {
  alignToFrame,
  buildWavHeader,
  BYTES_PER_SAMPLE,
  BYTES_PER_SECOND,
  EXPECTED_PCM_FRAME_SIZE,
  ZERO_BUFFER,
  getPcmDurationMs,
  getTimelineOffsetMs,
} from "../shared/audio-format";
import {
  createSnippetAudioMetricsAccumulator,
  finalizeSnippetAudioMetrics,
  updateSnippetAudioMetrics,
} from "../shared/snippet-metrics";
import {
  MAX_DURATION_MS,
  MIN_GAP_FILL_FLOOR_MS,
  SNIPPET_HANGOVER_MS,
} from "./recording-config";
import {
  clearBackpressure,
  markBackpressure,
  writeChunkToWritable,
} from "./recording-debug";
import type { RecordingSession, UserAudioState } from "./recording-types";

export function createConcealmentFrame(state: UserAudioState): Buffer {
  const frameBytes = state.expectedFrameBytes || EXPECTED_PCM_FRAME_SIZE;

  if (!state.lastGoodPcmFrame || state.lastGoodPcmFrame.length !== frameBytes) {
    return Buffer.alloc(frameBytes, 0);
  }

  const output = Buffer.allocUnsafe(frameBytes);
  const sampleCount = frameBytes / BYTES_PER_SAMPLE;

  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const fade = 0.8 * (1 - sampleIndex / sampleCount);
    const byteOffset = sampleIndex * BYTES_PER_SAMPLE;
    const original = state.lastGoodPcmFrame.readInt16LE(byteOffset);
    const concealed = Math.round(original * fade);
    output.writeInt16LE(
      Math.max(-32768, Math.min(32767, concealed)),
      byteOffset,
    );
  }

  return output;
}

function writeSilencePaddingBytes(
  outputStream: UserAudioState["outputStream"],
  silenceByteCount: number,
  userId: string,
  onBackpressure?: () => void,
): number {
  const silenceBytes = alignToFrame(Math.max(0, silenceByteCount));
  if (silenceBytes <= 0) {
    return 0;
  }

  let bytesWritten = 0;
  while (bytesWritten < silenceBytes) {
    const chunkSize = Math.min(ZERO_BUFFER.length, silenceBytes - bytesWritten);
    writeChunkToWritable(
      outputStream,
      ZERO_BUFFER.subarray(0, chunkSize),
      onBackpressure,
    );
    bytesWritten += chunkSize;
  }

  console.log(
    `Wrote ${silenceBytes} bytes (~${getPcmDurationMs(silenceBytes).toFixed(1)}ms) of silence padding for user ${userId}`,
  );

  return bytesWritten;
}

export function writeSilencePadding(
  outputStream: UserAudioState["outputStream"],
  silenceDurationMs: number,
  userId: string,
  onBackpressure?: () => void,
): number {
  return writeSilencePaddingBytes(
    outputStream,
    Math.floor((silenceDurationMs / 1000) * BYTES_PER_SECOND),
    userId,
    onBackpressure,
  );
}

export function advanceUserAudioCursor(
  state: UserAudioState,
  byteCount: number,
): void {
  if (byteCount <= 0) {
    return;
  }

  state.bytesWritten += byteCount;
  state.sessionAudioCursorMs = getTimelineOffsetMs(state.bytesWritten);
}

export function computeSessionAnchoredGapMs(
  state: UserAudioState,
  sessionElapsedMs: number,
  expectedFrameMs: number,
): number {
  if (state.lastDecodedAudioTime === 0) {
    return 0;
  }

  const cursorLagMs = sessionElapsedMs - state.sessionAudioCursorMs;
  if (cursorLagMs <= 0) {
    return 0;
  }

  const jitterAllowanceMs = Math.max(
    expectedFrameMs / 2,
    MIN_GAP_FILL_FLOOR_MS,
  );

  if (cursorLagMs <= jitterAllowanceMs) {
    return 0;
  }

  return Math.min(cursorLagMs, MAX_DURATION_MS);
}

export function clearSnippetFinalizeTimeout(state: UserAudioState): void {
  if (!state.snippetFinalizeTimeout) {
    return;
  }

  clearTimeout(state.snippetFinalizeTimeout);
  state.snippetFinalizeTimeout = null;
}

function ensureSnippetStarted(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
): void {
  if (state.currentSnippet || !state.pendingSnippetStart) {
    return;
  }

  clearSnippetFinalizeTimeout(state);

  const startByteOffset = state.bytesWritten;
  const startMs = state.sessionAudioCursorMs;
  const pcmPath = join(
    session.sessionPath,
    userId,
    "snippets",
    `temp_${startMs}.pcm`,
  );
  const snippetStream = createWriteStream(pcmPath, { flags: "w" });

  snippetStream.on("error", (error) => {
    console.error(`Snippet stream error for user ${userId}:`, error.message);
  });
  snippetStream.on("drain", () => {
    clearBackpressure(
      session,
      userId,
      state,
      "snippet",
      state.snippetBackpressure,
    );
  });
  snippetStream.on("close", () => {
    clearBackpressure(
      session,
      userId,
      state,
      "snippet",
      state.snippetBackpressure,
    );
  });

  state.currentSnippet = {
    startMs,
    startByteOffset,
    bytesWritten: 0,
    stream: snippetStream,
    pcmPath,
    metricsAccumulator: createSnippetAudioMetricsAccumulator(),
  };
  state.pendingSnippetStart = false;
}

function writeChunkToCurrentSnippet(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
  chunk: Buffer,
): void {
  if (chunk.length === 0) {
    return;
  }

  ensureSnippetStarted(session, userId, state);
  const currentSnippet = state.currentSnippet;
  if (!currentSnippet) {
    return;
  }

  writeChunkToWritable(currentSnippet.stream, chunk, () => {
    markBackpressure(
      session,
      userId,
      state,
      "snippet",
      state.snippetBackpressure,
    );
  });
  currentSnippet.bytesWritten += chunk.length;
  updateSnippetAudioMetrics(currentSnippet.metricsAccumulator, chunk);
}

export function writeSilencePaddingToUserTimeline(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
  silenceDurationMs: number,
): number {
  const silenceBytes = writeSilencePadding(
    state.outputStream,
    silenceDurationMs,
    userId,
    () => {
      markBackpressure(
        session,
        userId,
        state,
        "output",
        state.outputBackpressure,
      );
    },
  );

  advanceUserAudioCursor(state, silenceBytes);
  return silenceBytes;
}

export function writeTrailingSilenceToSessionEnd(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
  targetEndByteOffset: number,
): number {
  const trailingSilenceBytes = alignToFrame(
    targetEndByteOffset - state.bytesWritten,
  );
  if (trailingSilenceBytes <= 0) {
    return 0;
  }

  const writtenSilenceBytes = writeSilencePaddingBytes(
    state.outputStream,
    trailingSilenceBytes,
    userId,
    () => {
      markBackpressure(
        session,
        userId,
        state,
        "output",
        state.outputBackpressure,
      );
    },
  );

  advanceUserAudioCursor(state, writtenSilenceBytes);
  state.lastDecodedAudioTime = session.stoppedAt?.getTime() ?? Date.now();

  return writtenSilenceBytes;
}

export function writeUserAudioChunk(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
  chunk: Buffer,
): void {
  if (chunk.length === 0) {
    return;
  }

  writeChunkToCurrentSnippet(session, userId, state, chunk);
  writeChunkToWritable(state.outputStream, chunk, () => {
    markBackpressure(
      session,
      userId,
      state,
      "output",
      state.outputBackpressure,
    );
  });
  mixChunkIntoDebugMergedFile(session, state, chunk);
  advanceUserAudioCursor(state, chunk.length);
  state.lastDecodedAudioTime = Date.now();
}

/**
 * Mixes a PCM chunk into the session-level debug merged file at the user's
 * current timeline position. Reads existing samples, sums with the new chunk
 * (clamped to Int16 range), and writes back. Only active when DEBUG_AUDIO is on.
 */
function mixChunkIntoDebugMergedFile(
  session: RecordingSession,
  state: UserAudioState,
  chunk: Buffer,
): void {
  if (session.debugMergedFd === null) {
    return;
  }

  const byteOffset = state.bytesWritten;
  const sampleCount = chunk.length / BYTES_PER_SAMPLE;

  const existingBuf = Buffer.alloc(chunk.length, 0);
  try {
    readSync(session.debugMergedFd, existingBuf, 0, chunk.length, byteOffset);
  } catch {
    // Read past EOF returns partial/zero data — the alloc(0) handles it
  }

  const mixedBuf = Buffer.allocUnsafe(chunk.length);
  for (let i = 0; i < sampleCount; i++) {
    const offset = i * BYTES_PER_SAMPLE;
    const existingSample = existingBuf.readInt16LE(offset);
    const newSample = chunk.readInt16LE(offset);
    const mixed = Math.max(-32768, Math.min(32767, existingSample + newSample));
    mixedBuf.writeInt16LE(mixed, offset);
  }

  try {
    writeSync(session.debugMergedFd, mixedBuf, 0, mixedBuf.length, byteOffset);
  } catch (error) {
    console.error(
      "Failed to write to debug merged PCM:",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function finalizeCurrentSnippet(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
): Promise<void> {
  clearSnippetFinalizeTimeout(state);

  if (state.snippetFinalizePromise) {
    return state.snippetFinalizePromise;
  }

  state.pendingSnippetStart = false;

  const currentSnippet = state.currentSnippet;
  if (!currentSnippet) {
    return Promise.resolve();
  }

  state.currentSnippet = undefined;

  const finalizePromise = new Promise<void>((resolve) => {
    currentSnippet.stream.end(() => {
      try {
        if (!existsSync(currentSnippet.pcmPath)) {
          resolve();
          return;
        }

        const snippetSize = Math.max(
          currentSnippet.bytesWritten,
          statSync(currentSnippet.pcmPath).size,
        );

        if (snippetSize === 0) {
          unlinkSync(currentSnippet.pcmPath);
          resolve();
          return;
        }

        const endMs = getTimelineOffsetMs(
          currentSnippet.startByteOffset + snippetSize,
        );
        const metrics = finalizeSnippetAudioMetrics(
          currentSnippet.metricsAccumulator,
        );
        session.speechSegments.push({
          userId,
          startMs: currentSnippet.startMs,
          endMs,
          byteStart: currentSnippet.startByteOffset,
          byteEnd: currentSnippet.startByteOffset + snippetSize,
          metrics,
        });

        const wavPath = join(
          session.sessionPath,
          userId,
          "snippets",
          `snippet_${currentSnippet.startMs}_${endMs}.wav`,
        );
        const wavHeader = buildWavHeader(snippetSize);
        const pcmData = readFileSync(currentSnippet.pcmPath);
        writeFileSync(wavPath, Buffer.concat([wavHeader, pcmData]));

        session.onSnippetFinalized?.({
          userId,
          wavPath,
          startMs: currentSnippet.startMs,
          endMs,
          metrics,
        });
      } catch (error) {
        console.error(`Error saving snippet for user ${userId}:`, error);
      }

      resolve();
    });
  }).finally(() => {
    if (state.snippetFinalizePromise === finalizePromise) {
      state.snippetFinalizePromise = null;
    }
  });

  state.snippetFinalizePromise = finalizePromise;
  return finalizePromise;
}

export function scheduleSnippetFinalization(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
): void {
  clearSnippetFinalizeTimeout(state);

  if (!state.currentSnippet && !state.pendingSnippetStart) {
    return;
  }

  state.snippetFinalizeTimeout = setTimeout(() => {
    state.snippetFinalizeTimeout = null;
    void finalizeCurrentSnippet(session, userId, state);
  }, SNIPPET_HANGOVER_MS);
}
