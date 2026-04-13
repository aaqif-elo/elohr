import { TRPCError } from "@trpc/server";
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from "fs";
import { isAbsolute, join, relative, resolve } from "path";
import {
  parseStoredSessionSummary,
  SESSION_SUMMARY_FILE_NAME,
} from "../../services/discord/recording/processing/session-summary";
import type {
  StoredSessionSummary,
  SummaryParticipant,
} from "../../services/discord/recording/processing/recording-processing.types";
import {
  getSessionIdCreatedAt,
  isSessionId,
} from "../../services/discord/recording/runtime/recording-session.store";
import type { SessionTimingMetadata } from "../../services/discord/recording/runtime/recording-types";

const RECORDINGS_PATH = process.env.RECORDINGS_PATH || "./recordings";

interface RecordingFile {
  name: string;
  type: "audio" | "transcript" | "summary" | "user_audio";
  size: number;
  userId?: string;
}

interface RecordingSession {
  id: string;
  createdAt: Date;
  files: RecordingFile[];
  userCount: number;
  durationSeconds: number | null;
  summaryTitle: string | null;
  channelName: string | null;
  textChannelName: string | null;
  participants: SummaryParticipant[];
  hasMerged: boolean;
  hasTranscript: boolean;
  hasSummary: boolean;
}

interface TimingFallback {
  channelName: string | null;
  textChannelName: string | null;
  durationSeconds: number | null;
}

export function getRecordingSessionPath(sessionId: string): string {
  if (!isSessionId(sessionId)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid recording session.",
    });
  }

  return join(RECORDINGS_PATH, sessionId);
}

export function readSessionSummary(sessionPath: string): StoredSessionSummary | null {
  const summaryJsonPath = join(sessionPath, SESSION_SUMMARY_FILE_NAME);
  if (!existsSync(summaryJsonPath)) {
    return null;
  }

  try {
    const rawSummary = readFileSync(summaryJsonPath, "utf-8");
    return parseStoredSessionSummary(rawSummary);
  } catch {
    return null;
  }
}

function readTimingData(sessionPath: string): TimingFallback {
  const timingPath = join(sessionPath, "timing.json");
  if (!existsSync(timingPath)) {
    return { channelName: null, textChannelName: null, durationSeconds: null };
  }

  try {
    const timing = JSON.parse(readFileSync(timingPath, "utf-8")) as SessionTimingMetadata;
    return {
      channelName: timing.channelName ?? null,
      textChannelName: timing.textChannelName ?? null,
      durationSeconds:
        typeof timing.totalDurationMs === "number"
          ? Math.floor(timing.totalDurationMs / 1000)
          : null,
    };
  } catch {
    return { channelName: null, textChannelName: null, durationSeconds: null };
  }
}

function discoverUserAudioFiles(sessionPath: string): RecordingFile[] {
  const userFiles: RecordingFile[] = [];
  const entries = readdirSync(sessionPath, { withFileTypes: true });
  const preferredExtensions = [".ogg", ".wav", ".pcm"];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const userDir = join(sessionPath, entry.name);

    for (const extension of preferredExtensions) {
      const preferredFileName = `user_${entry.name}${extension}`;
      const preferredFilePath = join(userDir, preferredFileName);

      if (!existsSync(preferredFilePath)) {
        continue;
      }

      const fileStat = statSync(preferredFilePath);
      userFiles.push({
        name: `${entry.name}/${preferredFileName}`,
        type: "user_audio",
        size: fileStat.size,
        userId: entry.name,
      });
      break;
    }
  }

  return userFiles;
}

function getTopLevelRecordingFiles(sessionPath: string): RecordingFile[] {
  const topLevelFiles: RecordingFile[] = [];
  const entries = readdirSync(sessionPath, { withFileTypes: true });
  const fileNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);

  const preferredMergedAudioFiles = ["merged.ogg", "merged.wav"];
  for (const mergedAudioFile of preferredMergedAudioFiles) {
    if (!fileNames.includes(mergedAudioFile)) {
      continue;
    }

    const fileStat = statSync(join(sessionPath, mergedAudioFile));
    topLevelFiles.push({
      name: mergedAudioFile,
      type: "audio",
      size: fileStat.size,
    });
    break;
  }

  if (fileNames.includes("transcript.txt")) {
    const fileStat = statSync(join(sessionPath, "transcript.txt"));
    topLevelFiles.push({
      name: "transcript.txt",
      type: "transcript",
      size: fileStat.size,
    });
  }

  const preferredSummaryFiles = [SESSION_SUMMARY_FILE_NAME, "summary.txt"];
  for (const summaryFile of preferredSummaryFiles) {
    if (!fileNames.includes(summaryFile)) {
      continue;
    }

    const fileStat = statSync(join(sessionPath, summaryFile));
    topLevelFiles.push({
      name: summaryFile,
      type: "summary",
      size: fileStat.size,
    });
    break;
  }

  return topLevelFiles;
}

export function listRecordingSessions(): RecordingSession[] {
  if (!existsSync(RECORDINGS_PATH)) {
    return [];
  }

  const sessions: RecordingSession[] = [];
  const entries = readdirSync(RECORDINGS_PATH, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || !isSessionId(entry.name)) {
      continue;
    }

    const sessionPath = join(RECORDINGS_PATH, entry.name);
    const storedSummary = readSessionSummary(sessionPath);
    const recordingFiles = [
      ...getTopLevelRecordingFiles(sessionPath),
      ...discoverUserAudioFiles(sessionPath),
    ];

    const userCount = storedSummary?.participantCount ?? recordingFiles.filter((file) => file.type === "user_audio").length;
    const timing = readTimingData(sessionPath);
    const channelName = storedSummary?.channelName ?? timing.channelName;
    const textChannelName = storedSummary?.textChannelName ?? timing.textChannelName;
    const durationSeconds = storedSummary?.durationSeconds ?? timing.durationSeconds;
    const createdAt = getSessionIdCreatedAt(entry.name) || new Date();

    sessions.push({
      id: entry.name,
      createdAt,
      files: recordingFiles,
      userCount,
      durationSeconds,
      summaryTitle: storedSummary?.title ?? null,
      channelName,
      textChannelName,
      participants: storedSummary?.participants ?? [],
      hasMerged: recordingFiles.some((file) => file.type === "audio"),
      hasTranscript: recordingFiles.some((file) => file.type === "transcript"),
      hasSummary: recordingFiles.some((file) => file.type === "summary"),
    });
  }

  sessions.sort((leftSession, rightSession) => rightSession.createdAt.getTime() - leftSession.createdAt.getTime());

  return sessions;
}

export function getFileContent(sessionId: string, fileName: string): string | null {
  const filePath = resolveRecordingFilePath(sessionId, fileName);
  if (!existsSync(filePath)) {
    return null;
  }

  return readFileSync(filePath, "utf-8");
}

export function deleteRecordingSession(sessionId: string): void {
  const sessionPath = getRecordingSessionPath(sessionId);

  if (!existsSync(sessionPath)) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Recording session not found.",
    });
  }

  try {
    rmSync(sessionPath, { recursive: true, force: true });
  } catch (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error instanceof Error ? error.message : "Failed to delete recording session.",
    });
  }
}

function canAccessRecordingSession(
  session: RecordingSession,
  viewerDiscordId: string,
  isAdmin: boolean,
): boolean {
  return isAdmin || session.participants.some((participant) => participant.discordId === viewerDiscordId);
}

export function filterAccessibleRecordingSessions(
  sessions: RecordingSession[],
  viewerDiscordId: string,
  isAdmin: boolean,
): RecordingSession[] {
  if (isAdmin) {
    return sessions;
  }

  return sessions.filter((session) => canAccessRecordingSession(session, viewerDiscordId, false));
}

export function assertAccessibleRecordingSession(
  sessionId: string,
  viewerDiscordId: string,
  isAdmin: boolean,
): RecordingSession {
  const session = listRecordingSessions().find((recordingSession) => recordingSession.id === sessionId);

  if (!session) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Recording session not found.",
    });
  }

  if (!canAccessRecordingSession(session, viewerDiscordId, isAdmin)) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "You do not have access to this recording.",
    });
  }

  return session;
}

export function resolveRecordingFilePath(sessionId: string, fileName: string): string {
  const sessionPath = resolve(getRecordingSessionPath(sessionId));
  const filePath = resolve(sessionPath, fileName);
  const relativePath = relative(sessionPath, filePath);

  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Invalid recording file.",
    });
  }

  return filePath;
}

export function getRecordingContentType(fileName: string): string {
  if (fileName.endsWith(".wav")) {
    return "audio/wav";
  }

  if (fileName.endsWith(".ogg")) {
    return "audio/ogg";
  }

  if (fileName.endsWith(".pcm")) {
    return "audio/pcm";
  }

  if (fileName.endsWith(".txt")) {
    return "text/plain";
  }

  if (fileName.endsWith(".json")) {
    return "application/json";
  }

  return "application/octet-stream";
}