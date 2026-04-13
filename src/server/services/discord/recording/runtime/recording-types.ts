import type { VoiceConnection, VoiceReceiver } from "@discordjs/voice";
import type { WriteStream } from "fs";
import type * as prism from "prism-media";
import type { OggOpusWriter } from "../shared/ogg-opus-writer";
import type {
  SnippetAudioMetrics,
  SnippetAudioMetricsAccumulator,
} from "../shared/snippet-metrics";

export interface AudioDebugStats {
  opusPacketsReceived: number;
  opusBytesReceived: number;
  opusPacketsSkipped: number;
  pcmFramesDecoded: number;
  pcmBytesDecoded: number;
  lastOpusPacketSize: number;
  lastPcmFrameSize: number;
  unusualPcmFrames: number;
  silentPcmFrames: number;
  suspiciousPcmFrames: number;
  decodeErrors: number;
  concealedFrames: number;
}

export interface OpusPacketDebugInfo {
  sequence: number;
  receivedAtMs: number;
  packetLengthBytes: number;
  tocByte: number;
  tocConfig: number;
  tocStereo: boolean;
  tocFrameCount: number;
  packetPrefixHex: string;
}

export interface ActiveSnippet {
  startMs: number;
  startByteOffset: number;
  bytesWritten: number;
  stream: WriteStream;
  pcmPath: string;
  metricsAccumulator: SnippetAudioMetricsAccumulator;
}

export interface StreamBackpressureState {
  active: boolean;
  totalEvents: number;
}

export interface UserAudioState {
  outputStream: WriteStream;
  decoder: prism.opus.Decoder;
  audioStream: ReturnType<VoiceReceiver["subscribe"]>;
  oggOpusWriter?: OggOpusWriter;
  isSubscribed: boolean;
  lastActivityTime: number;
  lastDecodedAudioTime: number;
  lastOpusTocByte: number;
  isDecodeSynced: boolean;
  consecutiveDecodeSuccesses: number;
  opusPacketSequence: number;
  recentOpusPackets: OpusPacketDebugInfo[];
  bytesWritten: number;
  sessionAudioCursorMs: number;
  debugStats: AudioDebugStats;
  lastGoodPcmFrame: Buffer | null;
  expectedFrameBytes: number;
  outputBackpressure: StreamBackpressureState;
  snippetBackpressure: StreamBackpressureState;
  decoderBackpressure: StreamBackpressureState;
  pendingSnippetStart: boolean;
  snippetFinalizeTimeout: NodeJS.Timeout | null;
  snippetFinalizePromise: Promise<void> | null;
  currentSnippet?: ActiveSnippet;
}

export interface SpeechSegment {
  userId: string;
  startMs: number;
  endMs: number;
  byteStart: number;
  byteEnd: number;
  metrics?: SnippetAudioMetrics;
}

export interface SnippetFinalizedEvent {
  userId: string;
  wavPath: string;
  startMs: number;
  endMs: number;
  metrics: SnippetAudioMetrics;
}

export type RecordingAutoStopReason =
  | "starter-absent"
  | "bot-alone"
  | "inactive";

export interface RecordingSession {
  id: string;
  guildId: string;
  channelId: string;
  channelName: string;
  textChannelName?: string;
  startedAt: Date;
  stoppedAt: Date | null;
  startedBy: string;
  connection: VoiceConnection;
  userStreams: Map<string, NodeJS.WritableStream>;
  userAudioStates: Map<string, UserAudioState>;
  userIds: Set<string>;
  userStartTimes: Map<string, number>;
  speechSegments: SpeechSegment[];
  sessionPath: string;
  debugLogPath: string | null;
  debugLogStream: WriteStream | null;
  debugMergedFd: number | null;
  lastVoiceActivityAt: number;
  maxDurationTimeout: NodeJS.Timeout | null;
  starterAbsentTimeout: NodeJS.Timeout | null;
  botAloneTimeout: NodeJS.Timeout | null;
  inactivityMonitorInterval: NodeJS.Timeout | null;
  receiver: VoiceReceiver | null;
  isStopping: boolean;
  autoStopInProgress: boolean;
  onAutoStop?: (reason: RecordingAutoStopReason) => Promise<void>;
  onSnippetFinalized?: (event: SnippetFinalizedEvent) => void;
}

export type DebugLogLevel = "log" | "warn" | "error";

export interface DebugLogDetails {
  userId?: string;
  userTrackMs?: number;
  sessionAudioMs?: number;
}

export type BackpressureTarget = "output" | "snippet" | "decoder";

export interface ChunkWritable {
  write(chunk: Buffer): boolean;
}

export interface SessionTimingMetadata {
  sessionId: string;
  channelName: string;
  textChannelName?: string;
  sessionStart: string;
  sessionStop: string;
  totalDurationMs: number;
  users: { discordId: string; startOffsetMs: number }[];
  speechSegments: SpeechSegment[];
}