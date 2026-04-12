import { existsSync, readFileSync } from "fs";
import { join } from "path";
import type {
  RecordingSession,
  SnippetFinalizedEvent,
  SpeechSegment,
} from "../runtime/recording-types";
import {
  decideSnippetTranscriptionPolicy,
  getSnippetAudioMetricsFromWav,
} from "../shared/snippet-metrics";
import type { TranscribedSegment } from "./recording-processing.types";
import { transcribeSnippetAudio } from "./transcription.service";

interface SessionTranscriptionState {
  segments: TranscribedSegment[];
  pendingPromises: Promise<void>[];
}

const sessionStates = new Map<string, SessionTranscriptionState>();

/**
 * Distributes transcription lines across a snippet's time range.
 * First line gets the snippet's start time; subsequent lines are
 * linearly spaced across the snippet duration.
 */
function distributeTimestamps(
  lines: string[],
  userId: string,
  startMs: number,
  endMs: number,
): TranscribedSegment[] {
  const durationMs = endMs - startMs;
  return lines.map((text, i) => ({
    userId,
    sessionMs:
      lines.length === 1
        ? startMs
        : startMs + Math.round((i / lines.length) * durationMs),
    text,
  }));
}

/**
 * Handles transcription of a single finalized snippet.
 * Resolves speaker name, transcribes the snippet, and stores resulting segments.
 */
async function handleSnippetTranscription(
  state: SessionTranscriptionState,
  event: SnippetFinalizedEvent,
): Promise<void> {
  const durationMs = event.endMs - event.startMs;
  const policy = decideSnippetTranscriptionPolicy(durationMs, event.metrics);
  if (!policy.shouldTranscribe) {
    return;
  }

  const lines = await transcribeSnippetAudio(event.wavPath);

  if (lines.length === 0) return;

  const segments = distributeTimestamps(
    lines,
    event.userId,
    event.startMs,
    event.endMs,
  );
  state.segments.push(...segments);
}

/**
 * Initialise live transcription for a recording session.
 * Sets the `onSnippetFinalized` callback on the session so that each
 * finalized snippet is transcribed in the background as it is produced.
 */
export function initLiveTranscription(session: RecordingSession): void {
  const state: SessionTranscriptionState = {
    segments: [],
    pendingPromises: [],
  };

  sessionStates.set(session.id, state);

  session.onSnippetFinalized = (event) => {
    const promise = handleSnippetTranscription(state, event).catch((error) => {
      console.error(
        `Live transcription failed for snippet ${event.startMs}-${event.endMs}:`,
        error,
      );
    });
    state.pendingPromises.push(promise);
  };
}

/** Wait for all in-flight transcription requests to complete. */
export async function waitForPendingTranscriptions(
  sessionId: string,
): Promise<void> {
  const state = sessionStates.get(sessionId);
  if (!state) return;

  await Promise.all(state.pendingPromises);
  state.pendingPromises = [];
}

/** Get all collected transcription segments for the session. */
export function getSessionSegments(
  sessionId: string,
): TranscribedSegment[] {
  return sessionStates.get(sessionId)?.segments ?? [];
}

/** Clean up state for a completed session. */
export function cleanupLiveTranscription(sessionId: string): void {
  sessionStates.delete(sessionId);
}

/**
 * Transcribes snippets from disk for offline / reprocessing use.
 * Each snippet is sent individually to ElevenLabs and timestamps are linearly
 * distributed within the snippet's duration.
 */
export async function transcribeSnippetsOffline(
  sessionPath: string,
  speechSegments: SpeechSegment[],
): Promise<TranscribedSegment[]> {
  const allSegments: TranscribedSegment[] = [];
  const sorted = [...speechSegments].sort((a, b) => a.startMs - b.startMs);

  for (const segment of sorted) {
    const durationMs = segment.endMs - segment.startMs;

    const wavPath = join(
      sessionPath,
      segment.userId,
      "snippets",
      `snippet_${segment.startMs}_${segment.endMs}.wav`,
    );
    if (!existsSync(wavPath)) continue;

    const metrics = segment.metrics ?? getSnippetAudioMetricsFromWav(readFileSync(wavPath));
    const policy = decideSnippetTranscriptionPolicy(durationMs, metrics);
    if (!policy.shouldTranscribe) continue;

    const lines = await transcribeSnippetAudio(wavPath);

    if (lines.length === 0) continue;

    allSegments.push(
      ...distributeTimestamps(lines, segment.userId, segment.startMs, segment.endMs),
    );
  }

  return allSegments;
}
