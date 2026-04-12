import { existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import type { SpeechSegment } from "../runtime/recording-types";
import {
  BYTES_PER_SECOND,
} from "../shared/audio-format";

/**
 * Discovers speech segments from snippet filenames on disk when speechSegments
 * metadata is missing (e.g., older sessions or crash recovery).
 */
export function discoverSegmentsFromFilesystem(
  sessionPath: string,
): SpeechSegment[] {
  const segments: SpeechSegment[] = [];

  for (const entry of readdirSync(sessionPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const snippetsDir = join(sessionPath, entry.name, "snippets");
    if (!existsSync(snippetsDir)) {
      continue;
    }

    for (const file of readdirSync(snippetsDir)) {
      const match = file.match(/^snippet_(\d+)_(\d+)\.wav$/);
      if (!match) {
        continue;
      }

      const startMs = parseInt(match[1], 10);
      const endMs = parseInt(match[2], 10);
      const wavPath = join(snippetsDir, file);
      const fileSize = statSync(wavPath).size;

      if (fileSize <= 44) {
        continue;
      }

      const pcmSize = fileSize - 44;
      // Approximate byte offsets from ms timestamps
      const byteStart = Math.floor((startMs / 1000) * BYTES_PER_SECOND);

      segments.push({
        userId: entry.name,
        startMs,
        endMs,
        byteStart,
        byteEnd: byteStart + pcmSize,
        metrics: undefined,
      });
    }
  }

  return segments.sort((a, b) => a.startMs - b.startMs);
}
