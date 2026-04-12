import type { TranscribedSegment } from "./recording-processing.types";

/** Maximum gap (ms) between consecutive same-speaker lines to merge into one turn. */
const SAME_SPEAKER_MERGE_GAP_MS = 2_000;

/** Formats milliseconds as [HH:MM:SS]. */
function formatTimestamp(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `[${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}]`;
}

/**
 * Creates a chronologically interleaved transcript from transcribed segments.
 * Consecutive same-speaker lines within SAME_SPEAKER_MERGE_GAP_MS are merged
 * into a single turn.
 */
export function createChronologicalTranscript(
  segments: TranscribedSegment[],
  userNames: Map<string, string>,
): string {
  if (segments.length === 0) {
    return "[No transcripts available]";
  }

  const sorted = [...segments].sort((a, b) => a.sessionMs - b.sessionMs);

  // Merge consecutive same-speaker lines that are close in time
  const merged: { userId: string; sessionMs: number; lines: string[] }[] = [];

  for (const segment of sorted) {
    const lastTurn = merged[merged.length - 1];
    const shouldMerge =
      lastTurn &&
      lastTurn.userId === segment.userId &&
      segment.sessionMs - lastTurn.sessionMs < SAME_SPEAKER_MERGE_GAP_MS;

    if (shouldMerge) {
      lastTurn.lines.push(segment.text);
    } else {
      merged.push({
        userId: segment.userId,
        sessionMs: segment.sessionMs,
        lines: [segment.text],
      });
    }
  }

  // Build participant list
  const participantIds = [...new Set(segments.map((s) => s.userId))];
  const participantNames = participantIds.map(
    (id) => userNames.get(id) ?? `User ${id.slice(0, 8)}`,
  );

  let output = "# Conversation Transcript\n\n";
  output += "## Participants\n";
  for (const name of participantNames) {
    output += `- ${name}\n`;
  }
  output += "\n## Transcript\n\n";

  for (const turn of merged) {
    const name = userNames.get(turn.userId) ?? `User ${turn.userId.slice(0, 8)}`;
    const timestamp = formatTimestamp(turn.sessionMs);
    output += `${timestamp} ${name}: ${turn.lines.join(" ")}\n`;
  }

  return output;
}