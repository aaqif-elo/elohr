import {
  BYTES_PER_SAMPLE,
  CHANNELS,
  getPcmDurationMs,
  OPUS_FRAME_DURATION_MS,
  SAMPLE_RATE,
} from "./audio-format";

interface OpusTocInfo {
  config: number;
  stereo: boolean;
  frameCode: number;
  frameCount: number;
  isValidOpusConfig: boolean;
  isDiscordTypicalConfig: boolean;
}

export function parseOpusToc(tocByte: number): OpusTocInfo {
  const config = (tocByte >> 3) & 0x1f;
  const stereo = ((tocByte >> 2) & 0x01) === 1;
  const frameCode = tocByte & 0x03;
  const frameCount = frameCode === 0 ? 1 : frameCode === 3 ? -1 : 2;

  return {
    config,
    stereo,
    frameCode,
    frameCount,
    isValidOpusConfig: config >= 0 && config <= 31,
    isDiscordTypicalConfig: config >= 12 && config <= 31,
  };
}

function getOpusFrameDurationMs(config: number): number {
  if (config < 12) {
    const silkDurations = [10, 20, 40, 60];
    return silkDurations[config % 4];
  }

  if (config < 16) {
    return config % 2 === 0 ? 10 : 20;
  }

  const celtDurations = [2.5, 5, 10, 20];
  return celtDurations[config % 4];
}

export function getExpectedPacketDurationMs(
  tocByte: number,
  fallbackPcmByteLength?: number,
): number {
  if (tocByte < 0) {
    return fallbackPcmByteLength && fallbackPcmByteLength > 0
      ? getPcmDurationMs(fallbackPcmByteLength)
      : OPUS_FRAME_DURATION_MS;
  }

  const tocInfo = parseOpusToc(tocByte);
  const frameDurationMs = getOpusFrameDurationMs(tocInfo.config);

  if (tocInfo.frameCount > 0) {
    return frameDurationMs * tocInfo.frameCount;
  }

  return fallbackPcmByteLength && fallbackPcmByteLength > 0
    ? getPcmDurationMs(fallbackPcmByteLength)
    : OPUS_FRAME_DURATION_MS;
}

export function isExpectedPcmFrameSize(
  pcmByteLength: number,
  tocByte: number,
): boolean {
  const tocInfo = parseOpusToc(tocByte);
  const frameDurationMs = getOpusFrameDurationMs(tocInfo.config);
  const pcmBytesPerFrame =
    (frameDurationMs / 1000) * SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;

  if (tocInfo.frameCount > 0) {
    return pcmByteLength === pcmBytesPerFrame * tocInfo.frameCount;
  }

  return pcmByteLength > 0 && pcmByteLength % pcmBytesPerFrame === 0;
}

function getOpusPacketFrameCount(packet: Buffer): number {
  if (packet.length === 0) {
    return 0;
  }

  const tocInfo = parseOpusToc(packet[0]);
  if (tocInfo.frameCount > 0) {
    return tocInfo.frameCount;
  }

  if (packet.length < 2) {
    return 0;
  }

  const variableFrameCount = packet[1] & 0x3f;
  if (variableFrameCount <= 0 || variableFrameCount > 48) {
    return 0;
  }

  return variableFrameCount;
}

export function getOpusPacketSampleCount(packet: Buffer): number {
  if (packet.length === 0) {
    return 0;
  }

  const tocInfo = parseOpusToc(packet[0]);
  const frameCount = getOpusPacketFrameCount(packet);
  if (frameCount <= 0) {
    return Math.round((OPUS_FRAME_DURATION_MS / 1000) * SAMPLE_RATE);
  }

  const samplesPerFrame = Math.max(
    1,
    Math.round((getOpusFrameDurationMs(tocInfo.config) / 1000) * SAMPLE_RATE),
  );

  return samplesPerFrame * frameCount;
}