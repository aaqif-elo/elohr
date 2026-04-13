import { appendFileSync, existsSync, readFileSync, writeFileSync } from "fs";
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
  transcriptSegmentsPath: string;
  segmentCount: number;
  pendingTranscriptions: Set<Promise<void>>;
}

const sessionStates = new Map<string, SessionTranscriptionState>();
const TRANSCRIPT_SEGMENTS_FILE_NAME = "transcript.segments.jsonl";

function getStringProperty(value: unknown, propertyName: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const propertyValue = Reflect.get(value, propertyName);
  return typeof propertyValue === "string" ? propertyValue : null;
}

function getNumberProperty(value: unknown, propertyName: string): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const propertyValue = Reflect.get(value, propertyName);
  return typeof propertyValue === "number" && Number.isFinite(propertyValue)
    ? propertyValue
    : null;
}

function ensureTranscriptSegmentsFile(sessionPath: string): string {
  const transcriptSegmentsPath = join(sessionPath, TRANSCRIPT_SEGMENTS_FILE_NAME);
  if (!existsSync(transcriptSegmentsPath)) {
    writeFileSync(transcriptSegmentsPath, "", "utf-8");
  }

  return transcriptSegmentsPath;
}

export function resetSessionTranscribedSegments(sessionPath: string): void {
  const transcriptSegmentsPath = join(sessionPath, TRANSCRIPT_SEGMENTS_FILE_NAME);
  writeFileSync(transcriptSegmentsPath, "", "utf-8");
}

function appendSegmentsToTranscriptFile(
  transcriptSegmentsPath: string,
  segments: TranscribedSegment[],
): void {
  if (segments.length === 0) {
    return;
  }

  const payload = `${segments.map((segment) => JSON.stringify(segment)).join("\n")}\n`;
  appendFileSync(transcriptSegmentsPath, payload, "utf-8");
}

function parseTranscribedSegment(line: string): TranscribedSegment | null {
  if (!line.trim()) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(line);
    const userId = getStringProperty(parsed, "userId");
    const text = getStringProperty(parsed, "text");
    const sessionMs = getNumberProperty(parsed, "sessionMs");

    if (!userId || !text || sessionMs === null) {
      return null;
    }

    return {
      userId,
      sessionMs,
      text,
    };
  } catch {
    return null;
  }
}

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
  appendSegmentsToTranscriptFile(state.transcriptSegmentsPath, segments);
  state.segmentCount += segments.length;
}

/**
 * Initialise live transcription for a recording session.
 * Sets the `onSnippetFinalized` callback on the session so that each
 * finalized snippet is transcribed in the background as it is produced.
 */
export function initLiveTranscription(session: RecordingSession): void {
  resetSessionTranscribedSegments(session.sessionPath);

  const state: SessionTranscriptionState = {
    transcriptSegmentsPath: ensureTranscriptSegmentsFile(session.sessionPath),
    segmentCount: 0,
    pendingTranscriptions: new Set(),
  };

  sessionStates.set(session.id, state);

  session.onSnippetFinalized = (event) => {
    const pendingTranscription = handleSnippetTranscription(state, event).catch(
      (error) => {
        console.error(
          `Live transcription failed for snippet ${event.startMs}-${event.endMs}:`,
          error,
        );
      },
    );

    state.pendingTranscriptions.add(pendingTranscription);
    void pendingTranscription.finally(() => {
      state.pendingTranscriptions.delete(pendingTranscription);
    });
  };
}

/** Wait for all in-flight transcription requests to complete. */
export async function waitForPendingTranscriptions(
  sessionId: string,
): Promise<void> {
  const state = sessionStates.get(sessionId);
  if (!state) {
    return;
  }

  await Promise.all([...state.pendingTranscriptions]);
}

export function getSessionTranscriptSegmentCount(
  sessionId: string,
): number {
  return sessionStates.get(sessionId)?.segmentCount ?? 0;
}

export function readSessionTranscribedSegments(
  sessionPath: string,
): TranscribedSegment[] {
  const transcriptSegmentsPath = ensureTranscriptSegmentsFile(sessionPath);
  const rawContents = readFileSync(transcriptSegmentsPath, "utf-8");
  if (!rawContents.trim()) {
    return [];
  }

  const segments: TranscribedSegment[] = [];
  for (const line of rawContents.split(/\r?\n/)) {
    const segment = parseTranscribedSegment(line);
    if (segment) {
      segments.push(segment);
    }
  }

  return segments;
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
): Promise<number> {
  const transcriptSegmentsPath = ensureTranscriptSegmentsFile(sessionPath);
  let transcribedSegmentCount = 0;
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

    if (lines.length === 0) {
      continue;
    }

    const transcribedSegments = distributeTimestamps(
      lines,
      segment.userId,
      segment.startMs,
      segment.endMs,
    );
    appendSegmentsToTranscriptFile(transcriptSegmentsPath, transcribedSegments);
    transcribedSegmentCount += transcribedSegments.length;
  }

  return transcribedSegmentCount;
}
