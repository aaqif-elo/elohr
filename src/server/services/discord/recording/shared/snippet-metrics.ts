import {
  BYTES_PER_SAMPLE,
  EXPECTED_PCM_FRAME_SIZE,
  getPcmDurationMs,
} from "./audio-format";

function parseIntegerConfig(
  envValue: string | undefined,
  fallback: number,
): number {
  const parsedValue = Number.parseInt(envValue ?? "", 10);
  return Number.isFinite(parsedValue) && parsedValue >= 0
    ? parsedValue
    : fallback;
}

function parseFloatConfig(
  envValue: string | undefined,
  fallback: number,
): number {
  const parsedValue = Number.parseFloat(envValue ?? "");
  return Number.isFinite(parsedValue) && parsedValue >= 0
    ? parsedValue
    : fallback;
}

const ACTIVE_CHUNK_RMS_THRESHOLD = parseIntegerConfig(
  process.env.SNIPPET_ACTIVE_CHUNK_RMS_THRESHOLD,
  450,
);
const ACTIVE_CHUNK_PEAK_THRESHOLD = parseIntegerConfig(
  process.env.SNIPPET_ACTIVE_CHUNK_PEAK_THRESHOLD,
  1800,
);
const MIN_TRANSCRIPTION_DURATION_MS = parseIntegerConfig(
  process.env.MIN_SNIPPET_TRANSCRIPTION_DURATION_MS,
  700,
);
const MIN_ACTIVE_AUDIO_MS = parseIntegerConfig(
  process.env.MIN_SNIPPET_ACTIVE_AUDIO_MS,
  240,
);
const MIN_ACTIVE_AUDIO_RATIO = parseFloatConfig(
  process.env.MIN_SNIPPET_ACTIVE_AUDIO_RATIO,
  0.35,
);
const MIN_AVERAGE_RMS = parseIntegerConfig(
  process.env.MIN_SNIPPET_AVERAGE_RMS,
  320,
);
const MIN_PEAK_ABS_SAMPLE = parseIntegerConfig(
  process.env.MIN_SNIPPET_PEAK_ABS_SAMPLE,
  1500,
);
const MIN_RICH_CONTEXT_DURATION_MS = parseIntegerConfig(
  process.env.MIN_RICH_CONTEXT_SNIPPET_DURATION_MS,
  1400,
);
const MIN_RICH_CONTEXT_ACTIVE_AUDIO_MS = parseIntegerConfig(
  process.env.MIN_RICH_CONTEXT_ACTIVE_AUDIO_MS,
  500,
);
const MIN_RICH_CONTEXT_ACTIVE_AUDIO_RATIO = parseFloatConfig(
  process.env.MIN_RICH_CONTEXT_ACTIVE_AUDIO_RATIO,
  0.5,
);

export interface SnippetAudioMetrics {
  frameCount: number;
  activeAudioMs: number;
  silentAudioMs: number;
  averageRms: number;
  peakAbsSample: number;
}

export interface SnippetAudioMetricsAccumulator {
  frameCount: number;
  activeAudioMs: number;
  silentAudioMs: number;
  totalRms: number;
  peakAbsSample: number;
}

interface SnippetTranscriptionPolicy {
  shouldTranscribe: boolean;
  includeChannelName: boolean;
  includeParticipantNames: boolean;
  reason: string;
}

interface PcmChunkSignalMetrics {
  durationMs: number;
  rms: number;
  peakAbsSample: number;
  isSilent: boolean;
  isActive: boolean;
}

export function createSnippetAudioMetricsAccumulator(): SnippetAudioMetricsAccumulator {
  return {
    frameCount: 0,
    activeAudioMs: 0,
    silentAudioMs: 0,
    totalRms: 0,
    peakAbsSample: 0,
  };
}

function analyzePcmChunk(chunk: Buffer): PcmChunkSignalMetrics {
  if (chunk.length < BYTES_PER_SAMPLE) {
    return {
      durationMs: 0,
      rms: 0,
      peakAbsSample: 0,
      isSilent: true,
      isActive: false,
    };
  }

  let sumSquares = 0;
  let peakAbsSample = 0;

  for (let offset = 0; offset + 1 < chunk.length; offset += BYTES_PER_SAMPLE) {
    const sample = chunk.readInt16LE(offset);
    const absSample = Math.abs(sample);
    sumSquares += sample * sample;
    if (absSample > peakAbsSample) {
      peakAbsSample = absSample;
    }
  }

  const sampleCount = Math.floor(chunk.length / BYTES_PER_SAMPLE);
  const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;
  const durationMs = getPcmDurationMs(chunk.length);
  const isSilent = peakAbsSample === 0;
  const isActive =
    peakAbsSample >= ACTIVE_CHUNK_PEAK_THRESHOLD ||
    rms >= ACTIVE_CHUNK_RMS_THRESHOLD;

  return {
    durationMs,
    rms,
    peakAbsSample,
    isSilent,
    isActive,
  };
}

export function updateSnippetAudioMetrics(
  accumulator: SnippetAudioMetricsAccumulator,
  chunk: Buffer,
): void {
  const signalMetrics = analyzePcmChunk(chunk);
  if (signalMetrics.durationMs <= 0) {
    return;
  }

  accumulator.frameCount += 1;
  accumulator.totalRms += signalMetrics.rms;
  accumulator.peakAbsSample = Math.max(
    accumulator.peakAbsSample,
    signalMetrics.peakAbsSample,
  );

  if (signalMetrics.isSilent) {
    accumulator.silentAudioMs += signalMetrics.durationMs;
  }

  if (signalMetrics.isActive) {
    accumulator.activeAudioMs += signalMetrics.durationMs;
  }
}

export function finalizeSnippetAudioMetrics(
  accumulator: SnippetAudioMetricsAccumulator,
): SnippetAudioMetrics {
  return {
    frameCount: accumulator.frameCount,
    activeAudioMs: Math.round(accumulator.activeAudioMs),
    silentAudioMs: Math.round(accumulator.silentAudioMs),
    averageRms:
      accumulator.frameCount > 0
        ? Math.round(accumulator.totalRms / accumulator.frameCount)
        : 0,
    peakAbsSample: Math.round(accumulator.peakAbsSample),
  };
}

function getSnippetAudioMetricsFromPcm(
  pcmBuffer: Buffer,
): SnippetAudioMetrics {
  const accumulator = createSnippetAudioMetricsAccumulator();

  for (
    let offset = 0;
    offset < pcmBuffer.length;
    offset += EXPECTED_PCM_FRAME_SIZE
  ) {
    const chunk = pcmBuffer.subarray(
      offset,
      Math.min(offset + EXPECTED_PCM_FRAME_SIZE, pcmBuffer.length),
    );
    updateSnippetAudioMetrics(accumulator, chunk);
  }

  return finalizeSnippetAudioMetrics(accumulator);
}

export function getSnippetAudioMetricsFromWav(
  wavBuffer: Buffer,
): SnippetAudioMetrics {
  const pcmOffset = wavBuffer.length >= 44 ? 44 : 0;
  return getSnippetAudioMetricsFromPcm(wavBuffer.subarray(pcmOffset));
}

export function decideSnippetTranscriptionPolicy(
  durationMs: number,
  metrics: SnippetAudioMetrics,
): SnippetTranscriptionPolicy {
  const activeRatio = durationMs > 0 ? metrics.activeAudioMs / durationMs : 0;
  const hasEnoughSignal =
    metrics.averageRms >= MIN_AVERAGE_RMS ||
    metrics.peakAbsSample >= MIN_PEAK_ABS_SAMPLE;

  if (durationMs < MIN_TRANSCRIPTION_DURATION_MS) {
    return {
      shouldTranscribe: false,
      includeChannelName: false,
      includeParticipantNames: false,
      reason: `duration ${Math.round(durationMs)}ms below threshold`,
    };
  }

  if (metrics.activeAudioMs < MIN_ACTIVE_AUDIO_MS) {
    return {
      shouldTranscribe: false,
      includeChannelName: false,
      includeParticipantNames: false,
      reason: `active audio ${metrics.activeAudioMs}ms below threshold`,
    };
  }

  if (activeRatio < MIN_ACTIVE_AUDIO_RATIO) {
    return {
      shouldTranscribe: false,
      includeChannelName: false,
      includeParticipantNames: false,
      reason: `active ratio ${activeRatio.toFixed(2)} below threshold`,
    };
  }

  if (!hasEnoughSignal) {
    return {
      shouldTranscribe: false,
      includeChannelName: false,
      includeParticipantNames: false,
      reason: "audio energy below threshold",
    };
  }

  const includeRichContext =
    durationMs >= MIN_RICH_CONTEXT_DURATION_MS &&
    metrics.activeAudioMs >= MIN_RICH_CONTEXT_ACTIVE_AUDIO_MS &&
    activeRatio >= MIN_RICH_CONTEXT_ACTIVE_AUDIO_RATIO;

  return {
    shouldTranscribe: true,
    includeChannelName: includeRichContext,
    includeParticipantNames: includeRichContext,
    reason: includeRichContext
      ? "clear snippet with enough signal for rich context"
      : "transcribable snippet but context-restricted",
  };
}