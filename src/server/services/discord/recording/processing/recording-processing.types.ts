export interface UserTranscript {
  discordId: string;
  userName: string;
  startTimeOffset: number;
  transcript: string;
  mp3Path: string;
}

export interface SummaryParticipant {
  discordId: string;
  userName: string;
}

export interface ProcessingResult {
  sessionId: string;
  sessionPath: string;
  mergedAudioPath: string | null;
  transcriptPath: string | null;
  summaryPath: string | null;
  summary: string | null;
  userCount: number;
  duration: number;
  summaryParticipants: SummaryParticipant[];
  userTranscripts: UserTranscript[];
}

export interface SnippetInfo {
  userId: string;
  fileName: string;
  startMs: number;
  startByte: number;
  pcmPath: string;
  sizeBytes: number;
}

export interface SessionMixInput {
  userId: string;
  inputFormat: "pcm" | "wav";
  inputPath: string;
  durationSec: number;
}

export interface SnippetDiscoveryResult {
  snippets: SnippetInfo[];
  warnings: string[];
}

export interface SessionMergeResult {
  wavPath: string;
  mp3Path: string;
  totalDurationSec: number;
  trackCount: number;
  snippetCount: number;
  snippetWarningCount: number;
}

export interface SnippetMergeResult {
  pcmPath: string;
  wavPath: string;
  mp3Path: string;
  totalDurationSec: number;
  snippetCount: number;
  snippetWarningCount: number;
  chunkCount: number;
}

export interface SummaryPromptContext {
  sessionId?: string;
  channelName?: string;
  participantNames: string[];
}

/** A single transcribed line anchored to the session timeline. */
export interface TranscribedSegment {
  userId: string;
  /** Session-relative timestamp (ms). */
  sessionMs: number;
  /** Transcribed text. */
  text: string;
}