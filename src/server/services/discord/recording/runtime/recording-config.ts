export const DEBUG_AUDIO = process.env.DEBUG_AUDIO === "true";

export const OPUS_PACKET_DEBUG_BYTES = 32;
export const OPUS_PACKET_DEBUG_RING_SIZE = 8;
export const MIN_SUCCESSFUL_DECODES_FOR_SYNC = 2;
export const SNIPPET_HANGOVER_MS = 300;
export const MIN_GAP_FILL_FLOOR_MS = 10;

export const RECORDINGS_PATH = process.env.RECORDINGS_PATH || "./recordings";
export const MAX_DURATION_MINS = parseInt(
  process.env.RECORDING_MAX_DURATION_MINS || "90",
  10,
);
export const MAX_DURATION_MS = MAX_DURATION_MINS * 60 * 1000;