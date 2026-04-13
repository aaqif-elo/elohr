import type { Message } from "discord.js";
import { existsSync, readdirSync, statSync, writeFileSync } from "fs";
import { join } from "path";
import { getUserByDiscordId } from "../../../../db";
import { ERecordingStage } from "../../discord.enums";
import {
  clearRecordingLifecycle,
  getSessionDurationMs,
} from "../runtime/recording-session.store";
import { getStatusMessage } from "../runtime/recording-status";
import type { RecordingSession } from "../runtime/recording-types";
import {
  convertPcmToOgg,
  mergeSessionAudio,
} from "./audio-merge";
import {
  cleanupLiveTranscription,
  getSessionTranscriptSegmentCount,
  readSessionTranscribedSegments,
  resetSessionTranscribedSegments,
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
  createStoredSessionSummary,
  SESSION_SUMMARY_FILE_NAME,
} from "./session-summary";
import {
  generateSummary,
} from "./transcription.service";

interface ProcessRecordingOptions {
  onSummaryReady?: (result: ProcessingResult) => Promise<void>;
}

function createFallbackUserName(discordId: string): string {
  return `User ${discordId.slice(0, 8)}`;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

async function createSessionAudioArtifacts(
  session: RecordingSession,
): Promise<string> {
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

    const audioPath = join(userDir, `user_${discordId}.ogg`);
    await convertPcmToOgg(pcmPath, audioPath);
    hasAudio = true;
  }

  if (!hasAudio) {
    throw new Error("No valid audio files found in session");
  }

  const mergeResult = await mergeSessionAudio(session.sessionPath, "merged");
  return mergeResult.audioPath;
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
    textChannelName: session.textChannelName,
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
  options: ProcessRecordingOptions = {},
): Promise<ProcessingResult> {
  const result: ProcessingResult = {
    sessionId: session.id,
    sessionPath: session.sessionPath,
    mergedAudioPath: null,
    transcriptPath: null,
    summaryPath: null,
    summaryTitle: null,
    summary: null,
    userCount: session.userIds.size,
    duration: Math.floor(getSessionDurationMs(session) / 1000),
    summaryParticipants: [],
    userTranscripts: [],
  };

  const audioArtifactsPromise = createSessionAudioArtifacts(session)
    .then((mergedAudioPath) => ({ mergedAudioPath, error: null }))
    .catch((error: unknown) => ({ mergedAudioPath: null, error: toError(error) }));

  await updateStatusMessage(
    statusMessage,
    ERecordingStage.TRANSCRIBING,
    session.id,
  );

  let processingError: Error | null = null;

  try {
    await waitForPendingTranscriptions(session.id);

    let transcribedSegmentCount = getSessionTranscriptSegmentCount(session.id);
    if (transcribedSegmentCount === 0) {
      const speechSegments =
        session.speechSegments.length > 0
          ? session.speechSegments
          : discoverSegmentsFromFilesystem(session.sessionPath);

      if (speechSegments.length === 0) {
        console.warn(
          `No speech segments found for session ${session.id}, skipping transcription`,
        );
      } else {
        resetSessionTranscribedSegments(session.sessionPath);
        transcribedSegmentCount = await transcribeSnippetsOffline(
          session.sessionPath,
          speechSegments,
        );
      }
    }

    const allSegments: TranscribedSegment[] = readSessionTranscribedSegments(
      session.sessionPath,
    );
    const uniqueUserIds = [
      ...new Set([...session.userIds, ...allSegments.map((segment) => segment.userId)]),
    ];
    const userNames = await loadUserNames(uniqueUserIds);
    result.userCount = uniqueUserIds.length;
    result.summaryParticipants = buildSummaryParticipants(uniqueUserIds, userNames);

    const chronologicalTranscript = createChronologicalTranscript(
      allSegments,
      userNames,
    );
    const transcriptPath = join(session.sessionPath, "transcript.txt");
    writeFileSync(transcriptPath, chronologicalTranscript, "utf-8");
    result.transcriptPath = transcriptPath;

    console.log(`Transcription complete: ${transcribedSegmentCount} segments`);

    await updateStatusMessage(
      statusMessage,
      ERecordingStage.SUMMARIZING,
      session.id,
    );

    const generatedSummary = await generateSummary(
      chronologicalTranscript,
      session.sessionPath,
      buildSummaryContext(session, userNames),
    );
    const storedSummary = createStoredSessionSummary({
      sessionId: session.id,
      title: generatedSummary.title,
      summary: generatedSummary.summary,
      channelName: session.channelName,
      textChannelName: session.textChannelName,
      durationSeconds: result.duration,
      participants: result.summaryParticipants,
    });

    const summaryPath = join(session.sessionPath, SESSION_SUMMARY_FILE_NAME);
    writeFileSync(summaryPath, `${JSON.stringify(storedSummary, null, 2)}\n`, "utf-8");
    result.summaryPath = summaryPath;
    result.summaryTitle = storedSummary.title;
    result.summary = storedSummary.summary;

    if (options.onSummaryReady) {
      await options.onSummaryReady(result);
    }

    await updateStatusMessage(
      statusMessage,
      ERecordingStage.PROCESSING,
      session.id,
    );
  } catch (error) {
    processingError = toError(error);
  }

  const audioArtifactsResult = await audioArtifactsPromise;
  if (audioArtifactsResult.mergedAudioPath) {
    result.mergedAudioPath = audioArtifactsResult.mergedAudioPath;
  } else if (!processingError) {
    processingError = audioArtifactsResult.error;
  } else if (audioArtifactsResult.error) {
    console.error(`Audio merge failed for session ${session.id}:`, audioArtifactsResult.error);
  }

  cleanupLiveTranscription(session.id);
  clearRecordingLifecycle(session.id);

  if (processingError) {
    throw processingError;
  }

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