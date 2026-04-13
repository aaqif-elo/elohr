export {
  BYTES_PER_SECOND,
  CHANNELS,
  SAMPLE_RATE,
} from "./shared/audio-format";
export {
  mergeSessionAudio,
  mergeSnippetsToAudio,
} from "./processing/audio-merge";
export {
  initLiveTranscription,
  readSessionTranscribedSegments,
  resetSessionTranscribedSegments,
  transcribeSnippetsOffline,
} from "./processing/live-transcription.service";
export {
  processRecording,
} from "./processing/recording-processing.service";
export {
  discoverSegmentsFromFilesystem,
} from "./processing/snippet-batcher";
export {
  createChronologicalTranscript,
} from "./processing/transcript-format";
export {
  generateSummary,
} from "./processing/transcription.service";
export type {
  SummaryParticipant,
  SummaryPromptContext,
} from "./processing/recording-processing.types";
export {
  startRecording,
  stopRecording,
} from "./runtime/recording-runtime.service";
export {
  BOT_ALONE_GRACE_PERIOD_MS,
  NO_ACTIVITY_GRACE_PERIOD_MS,
  STARTER_RETURN_GRACE_PERIOD_MS,
  handleRecordingVoiceStateUpdate,
} from "./runtime/recording-auto-stop";
export {
  getCurrentRecordingLifecycle,
  getActiveSession,
  hasActiveSession,
} from "./runtime/recording-session.store";
export { getStatusMessage } from "./runtime/recording-status";
export type {
  RecordingAutoStopReason,
  RecordingSession,
} from "./runtime/recording-types";