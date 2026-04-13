import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import type { SpeechSegment } from "../runtime/recording-types";
import {
  alignToFrame,
  buildWavHeader,
  FRAME_ALIGNMENT,
  getTimelineByteOffset,
  getTimelineOffsetMs,
} from "../shared/audio-format";

interface PreparedSnippetWav {
  wavPath: string;
  isTemporary: boolean;
}

function createSpeechSegment(
  userId: string,
  startMs: number,
  pcmSize: number,
  endMs = getTimelineOffsetMs(getTimelineByteOffset(startMs) + pcmSize),
): SpeechSegment {
  const byteStart = getTimelineByteOffset(startMs);

  return {
    userId,
    startMs,
    endMs,
    byteStart,
    byteEnd: byteStart + pcmSize,
    metrics: undefined,
  };
}

function getSnippetKey(userId: string, startMs: number): string {
  return `${userId}:${startMs}`;
}

function getSnippetsDirectory(sessionPath: string, userId: string): string {
  return join(sessionPath, userId, "snippets");
}

function getSnippetPcmPath(
  sessionPath: string,
  userId: string,
  startMs: number,
): string {
  return join(getSnippetsDirectory(sessionPath, userId), `temp_${startMs}.pcm`);
}

function getSnippetWavPath(
  sessionPath: string,
  userId: string,
  startMs: number,
  endMs: number,
): string {
  return join(
    getSnippetsDirectory(sessionPath, userId),
    `snippet_${startMs}_${endMs}.wav`,
  );
}

function findExistingSnippetWavPath(
  sessionPath: string,
  userId: string,
  startMs: number,
  endMs: number,
): string | null {
  const exactPath = getSnippetWavPath(sessionPath, userId, startMs, endMs);
  if (existsSync(exactPath)) {
    return exactPath;
  }

  const snippetsDir = getSnippetsDirectory(sessionPath, userId);
  if (!existsSync(snippetsDir)) {
    return null;
  }

  const prefix = `snippet_${startMs}_`;
  const matchingFiles = readdirSync(snippetsDir)
    .filter((fileName) => fileName.startsWith(prefix) && fileName.endsWith(".wav"))
    .sort();

  if (matchingFiles.length === 0) {
    return null;
  }

  return join(snippetsDir, matchingFiles[0]);
}

function discoverSegmentFromSnippetWav(
  userId: string,
  snippetsDir: string,
  fileName: string,
): SpeechSegment | null {
  const match = fileName.match(/^snippet_(\d+)_(\d+)\.wav$/);
  if (!match) {
    return null;
  }

  const startMs = Number.parseInt(match[1], 10);
  const endMs = Number.parseInt(match[2], 10);
  const wavPath = join(snippetsDir, fileName);
  const pcmSize = alignToFrame(statSync(wavPath).size - 44);
  if (pcmSize < FRAME_ALIGNMENT) {
    return null;
  }

  return createSpeechSegment(userId, startMs, pcmSize, endMs);
}

function discoverSegmentFromSnippetPcm(
  userId: string,
  snippetsDir: string,
  fileName: string,
): SpeechSegment | null {
  const match = fileName.match(/^temp_(\d+)\.pcm$/);
  if (!match) {
    return null;
  }

  const pcmSize = alignToFrame(statSync(join(snippetsDir, fileName)).size);
  if (pcmSize < FRAME_ALIGNMENT) {
    return null;
  }

  const startMs = Number.parseInt(match[1], 10);
  return createSpeechSegment(userId, startMs, pcmSize);
}

/**
 * Discovers speech segments from snippet filenames on disk when speechSegments
 * metadata is missing (e.g., older sessions or crash recovery).
 */
export function discoverSegmentsFromFilesystem(
  sessionPath: string,
): SpeechSegment[] {
  const segmentsByKey = new Map<string, SpeechSegment>();

  for (const entry of readdirSync(sessionPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const snippetsDir = join(sessionPath, entry.name, "snippets");
    if (!existsSync(snippetsDir)) {
      continue;
    }

    for (const file of readdirSync(snippetsDir)) {
      const wavSegment = discoverSegmentFromSnippetWav(entry.name, snippetsDir, file);
      if (wavSegment) {
        segmentsByKey.set(getSnippetKey(entry.name, wavSegment.startMs), wavSegment);
        continue;
      }

      const pcmSegment = discoverSegmentFromSnippetPcm(entry.name, snippetsDir, file);
      if (!pcmSegment) {
        continue;
      }

      const segmentKey = getSnippetKey(entry.name, pcmSegment.startMs);
      if (!segmentsByKey.has(segmentKey)) {
        segmentsByKey.set(segmentKey, pcmSegment);
      }
    }
  }

  return [...segmentsByKey.values()].sort((left, right) => {
    if (left.startMs !== right.startMs) {
      return left.startMs - right.startMs;
    }

    if (left.userId !== right.userId) {
      return left.userId.localeCompare(right.userId);
    }

    return left.byteStart - right.byteStart;
  });
}

export function ensureSnippetWavForSegment(
  sessionPath: string,
  segment: SpeechSegment,
): PreparedSnippetWav | null {
  const existingWavPath = findExistingSnippetWavPath(
    sessionPath,
    segment.userId,
    segment.startMs,
    segment.endMs,
  );
  if (existingWavPath) {
    return { wavPath: existingWavPath, isTemporary: false };
  }

  const pcmPath = getSnippetPcmPath(sessionPath, segment.userId, segment.startMs);
  if (!existsSync(pcmPath)) {
    return null;
  }

  const pcmSize = alignToFrame(statSync(pcmPath).size);
  if (pcmSize < FRAME_ALIGNMENT) {
    return null;
  }

  const wavPath = getSnippetWavPath(
    sessionPath,
    segment.userId,
    segment.startMs,
    segment.endMs,
  );
  const pcmData = readFileSync(pcmPath).subarray(0, pcmSize);
  writeFileSync(wavPath, Buffer.concat([buildWavHeader(pcmSize), pcmData]));

  return { wavPath, isTemporary: true };
}

export function cleanupPreparedSnippetWav(
  preparedSnippetWav: PreparedSnippetWav,
): void {
  if (!preparedSnippetWav.isTemporary || !existsSync(preparedSnippetWav.wavPath)) {
    return;
  }

  try {
    unlinkSync(preparedSnippetWav.wavPath);
  } catch (error) {
    console.error(
      `Failed to delete temporary snippet WAV ${preparedSnippetWav.wavPath}:`,
      error,
    );
  }
}

export function cleanupSessionSnippetWavs(sessionPath: string): number {
  let deletedSnippetWavCount = 0;

  for (const entry of readdirSync(sessionPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const snippetsDir = getSnippetsDirectory(sessionPath, entry.name);
    if (!existsSync(snippetsDir)) {
      continue;
    }

    for (const fileName of readdirSync(snippetsDir)) {
      if (!/^snippet_\d+_\d+\.wav$/.test(fileName)) {
        continue;
      }

      const wavPath = join(snippetsDir, fileName);
      try {
        unlinkSync(wavPath);
        deletedSnippetWavCount++;
      } catch (error) {
        console.error(`Failed to delete snippet WAV ${wavPath}:`, error);
      }
    }
  }

  return deletedSnippetWavCount;
}
