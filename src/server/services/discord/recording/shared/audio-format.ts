export const SAMPLE_RATE = 48000;
export const CHANNELS = 2;
export const BYTES_PER_SAMPLE = 2;
export const FRAME_ALIGNMENT = CHANNELS * BYTES_PER_SAMPLE;
export const BYTES_PER_SECOND = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
export const OPUS_FRAME_DURATION_MS = 20;
export const EXPECTED_PCM_FRAME_SIZE =
  (SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE * OPUS_FRAME_DURATION_MS) / 1000;

// Reuse a static zero buffer for silence padding to avoid repeated allocations.
export const ZERO_BUFFER = Buffer.alloc(BYTES_PER_SECOND, 0);

export function alignToFrame(byteCount: number): number {
  return byteCount - (byteCount % FRAME_ALIGNMENT);
}

export function getPcmDurationMs(byteCount: number): number {
  return (byteCount / BYTES_PER_SECOND) * 1000;
}

export function getPcmDurationSeconds(byteCount: number): number {
  return byteCount / BYTES_PER_SECOND;
}

export function getTimelineByteOffset(durationMs: number): number {
  const sampleFrames = Math.max(0, Math.round((durationMs / 1000) * SAMPLE_RATE));
  return sampleFrames * FRAME_ALIGNMENT;
}

export function getTimelineOffsetMs(byteCount: number): number {
  return Math.round((byteCount / BYTES_PER_SECOND) * 1000);
}

export function buildWavHeader(pcmDataSize: number): Buffer {
  const header = Buffer.alloc(44);

  header.write("RIFF", 0, 4, "ascii");
  header.writeUInt32LE(36 + pcmDataSize, 4);
  header.write("WAVE", 8, 4, "ascii");

  header.write("fmt ", 12, 4, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(FRAME_ALIGNMENT, 32);
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);

  header.write("data", 36, 4, "ascii");
  header.writeUInt32LE(pcmDataSize, 40);

  return header;
}