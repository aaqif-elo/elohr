export interface RecordingFile {
  name: string;
  type: "audio" | "transcript" | "summary" | "user_audio";
  size: number;
  userId?: string;
}

export interface RecordingParticipant {
  discordId: string;
  userName: string;
}

export interface RecordingSession {
  id: string;
  createdAt: string | Date;
  files: RecordingFile[];
  userCount: number;
  durationSeconds: number | null;
  summaryTitle: string | null;
  channelName: string | null;
  textChannelName: string | null;
  participants: RecordingParticipant[];
  hasMerged: boolean;
  hasTranscript: boolean;
  hasSummary: boolean;
}

export interface StoredSessionSummary {
  version: 1;
  sessionId: string;
  title: string;
  summary: string;
  channelName?: string;
  textChannelName?: string;
  durationSeconds: number;
  participantCount: number;
  participants: RecordingParticipant[];
  generatedAt: string;
}

export function formatRecordingBytes(bytes: number): string {
  if (bytes === 0) {
    return "0 B";
  }

  const base = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const sizeIndex = Math.floor(Math.log(bytes) / Math.log(base));
  return `${parseFloat((bytes / Math.pow(base, sizeIndex)).toFixed(1))} ${sizes[sizeIndex]}`;
}

export function formatRecordingDate(dateValue: string | Date): string {
  const date = new Date(dateValue);
  return date.toLocaleString();
}

export function formatRecordingDuration(durationSeconds: number | null): string {
  if (durationSeconds === null || durationSeconds <= 0) {
    return "Unknown duration";
  }

  const minutes = Math.floor(durationSeconds / 60);
  const seconds = durationSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

export function getRecordingErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unable to load recordings.";
}

export function getRecordingTitle(recording: Pick<RecordingSession, "id" | "summaryTitle">): string {
  return recording.summaryTitle ?? recording.id;
}

export function matchesRecordingTitle(
  recording: Pick<RecordingSession, "id" | "summaryTitle">,
  title: string,
): boolean {
  return getRecordingTitle(recording) === title;
}

export function decodeRecordingRouteTitle(routeTitle: string | undefined): string {
  if (!routeTitle) {
    return "";
  }

  try {
    return decodeURIComponent(routeTitle);
  } catch {
    return routeTitle;
  }
}

export function getRecordingDetailsPath(
  recording: Pick<RecordingSession, "id" | "summaryTitle">,
): string {
  const title = encodeURIComponent(getRecordingTitle(recording));
  const sessionId = encodeURIComponent(recording.id);
  return `/recordings/${title}?session=${sessionId}`;
}

export function getRecordingDownloadUrl(sessionId: string, fileName: string): string {
  const encodedSessionId = encodeURIComponent(sessionId);
  const encodedFileName = encodeURIComponent(fileName);
  return `/api/recordings/download?session=${encodedSessionId}&file=${encodedFileName}`;
}

export function getRecordingDownloadFileName(fileName: string): string {
  const pathSegments = fileName.split("/");
  return pathSegments[pathSegments.length - 1] || fileName;
}