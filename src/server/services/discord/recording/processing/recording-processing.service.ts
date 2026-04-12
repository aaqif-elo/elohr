import type { Message } from "discord.js";
import { existsSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { getUserByDiscordId } from "../../../../db";
import { ERecordingStage } from "../../discord.enums";
import {
  getSessionDurationMs,
} from "../runtime/recording-session.store";
import { getStatusMessage } from "../runtime/recording-status";
import type { RecordingSession } from "../runtime/recording-types";
import {
  convertPcmToMp3,
  mergeSessionAudio,
} from "./audio-merge";
import {
  cleanupLiveTranscription,
  getSessionSegments,
  transcribeSnippetsOffline,
  waitForPendingTranscriptions,
} from "./live-transcription.service";
import type {
  ProcessingResult,
  SummaryParticipant,
  SummaryPromptContext,
  TranscribedSegment,
} from "./recording-processing.types";
import {
  discoverSegmentsFromFilesystem,
} from "./snippet-batcher";
import {
  createChronologicalTranscript,
} from "./transcript-format";
import {
  generateSummary,
} from "./transcription.service";

interface QueueItem {
  session: RecordingSession;
  statusMessage: Message;
  resolve: (result: ProcessingResult) => void;
  reject: (error: Error) => void;
}

const processingQueue: QueueItem[] = [];
let isProcessing = false;

function createFallbackUserName(discordId: string): string {
  return `User ${discordId.slice(0, 8)}`;
}

export async function queueRecordingForProcessing(
  session: RecordingSession,
  statusMessage: Message,
): Promise<ProcessingResult> {
  return new Promise((resolve, reject) => {
    const item: QueueItem = {
      session,
      statusMessage,
      resolve,
      reject,
    };

    processingQueue.push(item);
    console.log(
      `Added session ${session.id} to processing queue. Queue length: ${processingQueue.length}`,
    );

    void processNextInQueue();
  });
}

async function processNextInQueue(): Promise<void> {
  if (isProcessing || processingQueue.length === 0) {
    return;
  }

  isProcessing = true;
  const item = processingQueue.shift();
  if (!item) {
    isProcessing = false;
    return;
  }

  try {
    const result = await processRecording(item.session, item.statusMessage);
    item.resolve(result);
  } catch (error) {
    console.error(`Error processing session ${item.session.id}:`, error);
    item.reject(error instanceof Error ? error : new Error(String(error)));
  } finally {
    isProcessing = false;
    if (processingQueue.length > 0) {
      void processNextInQueue();
    }
  }
}

async function getUserName(discordId: string): Promise<string> {
  try {
    const user = await getUserByDiscordId(discordId);
    return user?.name || createFallbackUserName(discordId);
  } catch {
    return createFallbackUserName(discordId);
  }
}

async function loadUserNames(discordIds: string[]): Promise<Map<string, string>> {
  const userNames = new Map<string, string>();

  for (const discordId of discordIds) {
    userNames.set(discordId, await getUserName(discordId));
  }

  return userNames;
}

function buildSummaryContext(
  session: RecordingSession,
  userNames: Map<string, string>,
): SummaryPromptContext {
  return {
    sessionId: session.id,
    channelName: session.channelName,
    participantNames: [...userNames.values()],
  };
}

function buildSummaryParticipants(
  userIds: string[],
  userNames: Map<string, string>,
): SummaryParticipant[] {
  return userIds.map((discordId) => ({
    discordId,
    userName: userNames.get(discordId) ?? createFallbackUserName(discordId),
  }));
}

export async function processRecording(
  session: RecordingSession,
  statusMessage: Message,
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    sessionId: session.id,
    sessionPath: session.sessionPath,
    mergedAudioPath: null,
    transcriptPath: null,
    summaryPath: null,
    summary: null,
    userCount: session.userIds.size,
    duration: Math.floor(getSessionDurationMs(session) / 1000),
    summaryParticipants: [],
    userTranscripts: [],
  };

  await updateStatusMessage(
    statusMessage,
    ERecordingStage.PROCESSING,
    session.id,
  );

  // Convert per-user PCM to MP3 and merge for playback
  const entries = readdirSync(session.sessionPath, { withFileTypes: true });
  let hasAudio = false;

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const discordId = entry.name;
    const userDir = join(session.sessionPath, discordId);
    const pcmPath = join(userDir, `user_${discordId}.pcm`);

    if (!existsSync(pcmPath) || statSync(pcmPath).size <= 0) {
      continue;
    }

    const mp3Path = join(userDir, `user_${discordId}.mp3`);
    await convertPcmToMp3(pcmPath, mp3Path);
    hasAudio = true;
  }

  if (!hasAudio) {
    throw new Error("No valid audio files found in session");
  }

  const mergeResult = await mergeSessionAudio(session.sessionPath, "merged");
  result.mergedAudioPath = mergeResult.mp3Path;

  // Snippet-based transcription
  await updateStatusMessage(
    statusMessage,
    ERecordingStage.TRANSCRIBING,
    session.id,
  );

  // Collect live transcription results (produced during recording)
  await waitForPendingTranscriptions(session.id);
  let allSegments: TranscribedSegment[] = getSessionSegments(session.id);

  // Offline fallback: if no live segments exist, transcribe from disk
  if (allSegments.length === 0) {
    const speechSegments =
      session.speechSegments.length > 0
        ? session.speechSegments
        : discoverSegmentsFromFilesystem(session.sessionPath);

    if (speechSegments.length === 0) {
      console.warn(
        `No speech segments found for session ${session.id}, skipping transcription`,
      );
    } else {
      allSegments = await transcribeSnippetsOffline(
        session.sessionPath,
        speechSegments,
      );
    }
  }

  const uniqueUserIds = [
    ...new Set([...session.userIds, ...allSegments.map((s) => s.userId)]),
  ];
  const userNames = await loadUserNames(uniqueUserIds);
  result.summaryParticipants = buildSummaryParticipants(uniqueUserIds, userNames);

  const chronologicalTranscript = createChronologicalTranscript(
    allSegments,
    userNames,
  );
  const transcriptPath = join(session.sessionPath, "transcript.txt");
  writeFileSync(transcriptPath, chronologicalTranscript, "utf-8");
  result.transcriptPath = transcriptPath;

  console.log(
    `Transcription complete: ${allSegments.length} segments`,
  );

  cleanupLiveTranscription(session.id);

  await updateStatusMessage(
    statusMessage,
    ERecordingStage.SUMMARIZING,
    session.id,
  );

  const summary = await generateSummary(
    chronologicalTranscript,
    session.sessionPath,
    buildSummaryContext(session, userNames),
  );
  const summaryPath = join(session.sessionPath, "summary.txt");
  writeFileSync(summaryPath, summary, "utf-8");
  result.summaryPath = summaryPath;
  result.summary = summary;

  await updateStatusMessage(
    statusMessage,
    ERecordingStage.COMPLETE,
    session.id,
  );

  return result;
}

async function updateStatusMessage(
  message: Message,
  stage: ERecordingStage,
  sessionId: string,
  error?: string,
): Promise<void> {
  try {
    await message.edit({
      content: getStatusMessage(stage, sessionId, error),
    });
  } catch (updateError) {
    console.error("Failed to update status message:", updateError);
  }
}