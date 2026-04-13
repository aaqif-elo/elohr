import { spawn } from "child_process";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  statSync,
  writeSync as writeSyncToFile,
} from "fs";
import { join } from "path";
import { DEBUG_AUDIO } from "../runtime/recording-config";
import {
  alignToFrame,
  BYTES_PER_SECOND,
  BYTES_PER_SAMPLE,
  CHANNELS,
  FRAME_ALIGNMENT,
  getPcmDurationSeconds,
  getTimelineByteOffset,
  SAMPLE_RATE,
} from "../shared/audio-format";
import type {
  SessionMergeResult,
  SessionMixInput,
  SnippetDiscoveryResult,
  SnippetInfo,
  SnippetMergeResult,
} from "./recording-processing.types";

const SNIPPET_MERGE_WINDOW_MS = 30_000;
const SNIPPET_MERGE_WINDOW_BYTES = alignToFrame(
  Math.floor((SNIPPET_MERGE_WINDOW_MS / 1000) * BYTES_PER_SECOND),
);
const OGG_AUDIO_CODEC = "libopus";
const OGG_AUDIO_BITRATE = "96k";

function getTimelineStartByte(startMs: number): number {
  return getTimelineByteOffset(startMs);
}

function getSnippetMergeTotalBytes(snippets: SnippetInfo[]): number {
  let maxEndByte = 0;

  for (const snippet of snippets) {
    const snippetEndByte = snippet.startByte + snippet.sizeBytes;
    if (snippetEndByte > maxEndByte) {
      maxEndByte = snippetEndByte;
    }
  }

  return alignToFrame(maxEndByte);
}

function runFfmpeg(args: string[], actionDescription: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args]);

    let stderr = "";
    ffmpeg.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });

    ffmpeg.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      const suffix = stderr.trim() ? `: ${stderr.trim()}` : "";
      reject(new Error(`${actionDescription} failed with code ${code}${suffix}`));
    });

    ffmpeg.on("error", (error) => {
      reject(
        new Error(`Failed to spawn FFmpeg for ${actionDescription}: ${error.message}`),
      );
    });
  });
}

async function convertPcmToOgg(
  pcmPath: string,
  oggPath: string,
): Promise<void> {
  console.log(`Converting ${pcmPath} to OGG...`);
  await runFfmpeg(
    [
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      String(CHANNELS),
      "-i",
      pcmPath,
      "-codec:a",
      OGG_AUDIO_CODEC,
      "-b:a",
      OGG_AUDIO_BITRATE,
      "-vbr",
      "on",
      "-application",
      "audio",
      "-compression_level",
      "10",
      "-y",
      oggPath,
    ],
    `PCM to OGG conversion for ${pcmPath}`,
  );
  console.log(`Successfully converted to ${oggPath}`);
}

function discoverSnippets(sessionPath: string): SnippetDiscoveryResult {
  const snippets: SnippetInfo[] = [];
  const warnings: string[] = [];

  for (const entry of readdirSync(sessionPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const snippetsDir = join(sessionPath, entry.name, "snippets");
    if (!existsSync(snippetsDir)) {
      continue;
    }

    const userSnippets: SnippetInfo[] = [];

    for (const file of readdirSync(snippetsDir)) {
      const match = file.match(/^temp_(\d+)\.pcm$/);
      if (!match) {
        continue;
      }

      const pcmPath = join(snippetsDir, file);
      const rawSizeBytes = statSync(pcmPath).size;
      if (rawSizeBytes < FRAME_ALIGNMENT) {
        warnings.push(
          `User ${entry.name}: skipped tiny snippet ${file} (${rawSizeBytes} bytes)`,
        );
        continue;
      }

      const alignedSizeBytes = alignToFrame(rawSizeBytes);
      if (alignedSizeBytes !== rawSizeBytes) {
        warnings.push(
          `User ${entry.name}: truncated misaligned snippet ${file} from ${rawSizeBytes} to ${alignedSizeBytes} bytes`,
        );
      }

      if (alignedSizeBytes < FRAME_ALIGNMENT) {
        warnings.push(
          `User ${entry.name}: skipped snippet ${file} after alignment removed all audio`,
        );
        continue;
      }

      const startMs = Number.parseInt(match[1], 10);
      userSnippets.push({
        userId: entry.name,
        fileName: file,
        startMs,
        startByte: getTimelineStartByte(startMs),
        pcmPath,
        sizeBytes: alignedSizeBytes,
      });
    }

    userSnippets.sort((left, right) => left.startByte - right.startByte);

    let previousSnippet: SnippetInfo | null = null;
    for (const snippet of userSnippets) {
      if (previousSnippet) {
        const previousEndByte = previousSnippet.startByte + previousSnippet.sizeBytes;
        if (snippet.startByte < previousEndByte) {
          warnings.push(
            `User ${entry.name}: overlapping snippets detected (${previousSnippet.fileName} and ${snippet.fileName})`,
          );
        }
      }

      snippets.push(snippet);
      previousSnippet = snippet;
    }
  }

  snippets.sort((left, right) => {
    if (left.startByte !== right.startByte) {
      return left.startByte - right.startByte;
    }

    return left.userId.localeCompare(right.userId);
  });

  return { snippets, warnings };
}

function discoverSessionMixInputs(sessionPath: string): SessionMixInput[] {
  const mixInputs: SessionMixInput[] = [];

  for (const entry of readdirSync(sessionPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }

    const userId = entry.name;
    const userDir = join(sessionPath, userId);
    const wavPath = join(userDir, `user_${userId}.wav`);
    if (existsSync(wavPath)) {
      const wavSizeBytes = statSync(wavPath).size;
      if (wavSizeBytes > 44) {
        mixInputs.push({
          userId,
          inputFormat: "wav",
          inputPath: wavPath,
          durationSec: getPcmDurationSeconds(wavSizeBytes - 44),
        });
        continue;
      }
    }

    const pcmPath = join(userDir, `user_${userId}.pcm`);
    if (!existsSync(pcmPath)) {
      continue;
    }

    const pcmSizeBytes = alignToFrame(statSync(pcmPath).size);
    if (pcmSizeBytes < FRAME_ALIGNMENT) {
      continue;
    }

    mixInputs.push({
      userId,
      inputFormat: "pcm",
      inputPath: pcmPath,
      durationSec: getPcmDurationSeconds(pcmSizeBytes),
    });
  }

  mixInputs.sort((left, right) => left.userId.localeCompare(right.userId));
  return mixInputs;
}

function logSnippetWarnings(warnings: string[], mergeContext: string): void {
  if (warnings.length === 0) {
    return;
  }

  console.log(
    `Snippet validation found ${warnings.length} issue(s) during ${mergeContext}.`,
  );

  const maxWarningsToLog = DEBUG_AUDIO ? warnings.length : 10;
  for (const warning of warnings.slice(0, maxWarningsToLog)) {
    console.warn(`[Snippet validation] ${warning}`);
  }

  if (!DEBUG_AUDIO && warnings.length > maxWarningsToLog) {
    console.warn(
      `[Snippet validation] ${warnings.length - maxWarningsToLog} additional warning(s) omitted`,
    );
  }
}

function mergeSnippetsToPcm(
  snippets: SnippetInfo[],
  windowStartByte = 0,
  requestedWindowByteLength?: number,
): Buffer {
  if (snippets.length === 0) {
    throw new Error("No snippets to merge");
  }

  const totalBytes = getSnippetMergeTotalBytes(snippets);
  const alignedWindowStartByte = alignToFrame(Math.max(0, windowStartByte));
  const maxWindowByteLength = totalBytes - alignedWindowStartByte;
  const alignedWindowByteLength = requestedWindowByteLength === undefined
    ? maxWindowByteLength
    : alignToFrame(Math.max(0, requestedWindowByteLength));
  const windowByteLength = Math.min(maxWindowByteLength, alignedWindowByteLength);

  if (windowByteLength <= 0) {
    return Buffer.alloc(0);
  }

  const windowEndByte = alignedWindowStartByte + windowByteLength;
  const sampleCount = windowByteLength / BYTES_PER_SAMPLE;
  const accumulator = new Int32Array(sampleCount);

  for (const snippet of snippets) {
    const snippetStartByte = snippet.startByte;
    const snippetEndByte = snippet.startByte + snippet.sizeBytes;
    if (snippetEndByte <= alignedWindowStartByte || snippetStartByte >= windowEndByte) {
      continue;
    }

    const overlapStartByte = Math.max(snippetStartByte, alignedWindowStartByte);
    const overlapEndByte = Math.min(snippetEndByte, windowEndByte);
    const overlapByteLength = alignToFrame(overlapEndByte - overlapStartByte);
    if (overlapByteLength <= 0) {
      continue;
    }

    const pcmData = requireSnippetPcm(snippet.pcmPath);
    const snippetReadOffset = overlapStartByte - snippetStartByte;
    const readableByteLength = Math.min(
      overlapByteLength,
      Math.max(0, Math.min(snippet.sizeBytes, pcmData.length) - snippetReadOffset),
    );
    const alignedReadableByteLength = alignToFrame(readableByteLength);

    if (alignedReadableByteLength <= 0) {
      continue;
    }

    const outputWriteOffset = overlapStartByte - alignedWindowStartByte;
    const startSampleIndex = outputWriteOffset / BYTES_PER_SAMPLE;
    const snippetSampleOffset = snippetReadOffset / BYTES_PER_SAMPLE;
    const overlapSampleCount = alignedReadableByteLength / BYTES_PER_SAMPLE;

    for (let sampleIndex = 0; sampleIndex < overlapSampleCount; sampleIndex++) {
      const snippetByteOffset = (snippetSampleOffset + sampleIndex) * BYTES_PER_SAMPLE;
      accumulator[startSampleIndex + sampleIndex] += pcmData.readInt16LE(snippetByteOffset);
    }
  }

  const output = Buffer.alloc(windowByteLength);
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
    const clampedSample = Math.max(-32768, Math.min(32767, accumulator[sampleIndex]));
    output.writeInt16LE(clampedSample, sampleIndex * BYTES_PER_SAMPLE);
  }

  return output;
}

function requireSnippetPcm(pcmPath: string): Buffer {
  if (statSync(pcmPath).size <= 0) {
    return Buffer.alloc(0);
  }

  return readFileSync(pcmPath);
}

async function mixAlignedTracksToOgg(
  mixInputs: SessionMixInput[],
  oggPath: string,
): Promise<void> {
  const ffmpegArgs: string[] = [];

  for (const mixInput of mixInputs) {
    if (mixInput.inputFormat === "pcm") {
      ffmpegArgs.push(
        "-f",
        "s16le",
        "-ar",
        String(SAMPLE_RATE),
        "-ac",
        String(CHANNELS),
      );
    }

    ffmpegArgs.push("-i", mixInput.inputPath);
  }

  const inputLabels = mixInputs.map((_, index) => `[${index}:a]`).join("");
  const outputLabel = "mixed";
  const filterGraph = `${inputLabels}amix=inputs=${mixInputs.length}:duration=longest:dropout_transition=0,alimiter=limit=0.95[${outputLabel}]`;

  await runFfmpeg(
    [
      ...ffmpegArgs,
      "-filter_complex",
      filterGraph,
      "-map",
      `[${outputLabel}]`,
      "-codec:a",
      OGG_AUDIO_CODEC,
      "-b:a",
      OGG_AUDIO_BITRATE,
      "-vbr",
      "on",
      "-application",
      "audio",
      "-compression_level",
      "10",
      "-y",
      oggPath,
    ],
    `aligned track mix to ${oggPath}`,
  );
}

async function convertRawPcmToWav(pcmPath: string, wavPath: string): Promise<void> {
  await runFfmpeg(
    [
      "-f",
      "s16le",
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      String(CHANNELS),
      "-i",
      pcmPath,
      "-c:a",
      "pcm_s16le",
      "-y",
      wavPath,
    ],
    `raw PCM to WAV conversion for ${pcmPath}`,
  );
}

export async function mergeSnippetsToAudio(
  sessionPath: string,
  outputPrefix: string,
): Promise<SnippetMergeResult> {
  const snippetDiscovery = discoverSnippets(sessionPath);
  const { snippets, warnings } = snippetDiscovery;
  if (snippets.length === 0) {
    throw new Error("No snippet PCM files found in session");
  }

  logSnippetWarnings(warnings, "snippet reconstruction");

  const totalBytes = getSnippetMergeTotalBytes(snippets);
  const pcmPath = join(sessionPath, `${outputPrefix}.pcm`);
  const pcmFileDescriptor = openSync(pcmPath, "w");

  let chunkCount = 0;
  try {
    for (
      let windowStartByte = 0;
      windowStartByte < totalBytes;
      windowStartByte += SNIPPET_MERGE_WINDOW_BYTES
    ) {
      const windowByteLength = Math.min(
        SNIPPET_MERGE_WINDOW_BYTES,
        totalBytes - windowStartByte,
      );
      const mergedWindow = mergeSnippetsToPcm(
        snippets,
        windowStartByte,
        windowByteLength,
      );
      if (mergedWindow.length === 0) {
        continue;
      }

      writeSyncToFile(pcmFileDescriptor, mergedWindow, 0, mergedWindow.length);
      chunkCount++;
    }
  } finally {
    closeSync(pcmFileDescriptor);
  }

  console.log(
    `Reconstructed ${snippets.length} snippet(s) across ${chunkCount} chunk(s) into ${pcmPath}`,
  );

  const wavPath = join(sessionPath, `${outputPrefix}.wav`);
  await convertRawPcmToWav(pcmPath, wavPath);
  console.log(`Wrote ${wavPath}`);

  const audioPath = join(sessionPath, `${outputPrefix}.ogg`);
  await convertPcmToOgg(pcmPath, audioPath);
  console.log(`Wrote ${audioPath}`);

  return {
    pcmPath,
    wavPath,
    audioPath,
    totalDurationSec: getPcmDurationSeconds(totalBytes),
    snippetCount: snippets.length,
    snippetWarningCount: warnings.length,
    chunkCount,
  };
}

export async function mergeSessionAudio(
  sessionPath: string,
  outputPrefix: string,
): Promise<SessionMergeResult> {
  const snippetDiscovery = discoverSnippets(sessionPath);
  logSnippetWarnings(snippetDiscovery.warnings, "aligned-track mix");

  const mixInputs = discoverSessionMixInputs(sessionPath);
  if (mixInputs.length === 0) {
    throw new Error("No aligned user audio tracks found in session");
  }

  console.log(
    `Mixing ${mixInputs.length} aligned user track(s) with ffmpeg`,
  );

  const audioPath = join(sessionPath, `${outputPrefix}.ogg`);
  await mixAlignedTracksToOgg(mixInputs, audioPath);
  console.log(`Wrote ${audioPath}`);

  const totalDurationSec = Math.max(
    ...mixInputs.map((mixInput) => mixInput.durationSec),
  );

  return {
    wavPath: null,
    audioPath,
    totalDurationSec,
    trackCount: mixInputs.length,
    snippetCount: snippetDiscovery.snippets.length,
    snippetWarningCount: snippetDiscovery.warnings.length,
  };
}