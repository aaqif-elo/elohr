/**
 * Test the recording processing pipeline offline using the real code paths.
 *
 * Usage:
 *   npx tsx scripts/reprocess-session.ts <sessionDir> <operation>
 *
 * Operations:
 *   process          - Run the full processRecording pipeline (overwrites originals)
 *   merge            - Mix aligned user tracks → merged_<timestamp>.ogg
 *   merge-snippets   - Reconstruct from snippet PCMs → merged_snippets_<timestamp>.{pcm,wav,ogg}
 *   compare-merge    - Generate both merge strategies for side-by-side comparison
 *   verify-snippets  - Compare snippet PCM data against the raw OGG for each user
 *   transcript       - Regenerate transcript → transcript_<timestamp>.txt
 *   summary          - Regenerate summary → summary_<timestamp>.json
 *
 * The 'process' operation calls processRecording directly with mock Discord
 * objects, exercising the exact production code path (outputs overwrite originals).
 * Individual operations call the real helper functions but write to timestamped
 * filenames to preserve originals.
 *
 * Environment:
 *   ELEVEN_LABS_API_KEY or ELEVENLABS_API_KEY - Required for transcript / process operations
 *   GEMINI_API_KEY                             - Required for summary / process operations
 */

import "dotenv/config";

import { spawn } from "child_process";
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { basename, join, resolve } from "path";

// Real code imports
import type { Message } from "discord.js";
import { getUserByDiscordId } from "../src/server/db";
import {
  BYTES_PER_SECOND,
  CHANNELS,
  createChronologicalTranscript,
  discoverSegmentsFromFilesystem,
  generateSummary,
  mergeSessionAudio,
  mergeSnippetsToAudio,
  processRecording,
  readSessionTranscribedSegments,
  resetSessionTranscribedSegments,
  SAMPLE_RATE,
  transcribeSnippetsOffline,
} from "../src/server/services/discord/recording";
import {
  createStoredSessionSummary,
} from "../src/server/services/discord/recording/processing/session-summary";
import {
  cleanupSessionSnippetWavs,
} from "../src/server/services/discord/recording/processing/snippet-batcher";
import type {
  RecordingSession,
  SummaryPromptContext,
  SummaryParticipant,
} from "../src/server/services/discord/recording";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Compact timestamp for file suffixes: 20260404T153012 */
function fileSuffix(): string {
  return new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .slice(0, 15);
}

function fatal(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function createFallbackUserName(discordId: string): string {
  return `User ${discordId.slice(0, 8)}`;
}

async function getDiscordUserName(discordId: string): Promise<string> {
  try {
    const user = await getUserByDiscordId(discordId);
    return user?.name || createFallbackUserName(discordId);
  } catch {
    return createFallbackUserName(discordId);
  }
}

async function loadSessionUserNames(
  sessionPath: string,
  extraUserIds: Iterable<string> = [],
): Promise<Map<string, string>> {
  const absPath = resolve(sessionPath);
  const timing = readTiming(absPath);
  const uniqueUserIds = [
    ...new Set([
      ...discoverUsers(absPath).map((user) => user.discordId),
      ...(timing?.users.map((user) => user.discordId) ?? []),
      ...extraUserIds,
    ]),
  ];

  const userNames = new Map<string, string>();
  for (const userId of uniqueUserIds) {
    userNames.set(userId, await getDiscordUserName(userId));
  }

  return userNames;
}

function buildSummaryContext(
  sessionPath: string,
  channelName: string | undefined,
  textChannelName: string | undefined,
  userNames: Map<string, string>,
): SummaryPromptContext {
  return {
    sessionId: basename(resolve(sessionPath)),
    channelName,
    textChannelName,
    participantNames: [...userNames.values()],
  };
}

function getTranscriptOutputPath(sessionPath: string): string {
  return join(sessionPath, `transcript_${fileSuffix()}.txt`);
}

/** Create a mock Discord Message that logs status updates to stdout. */
function createMockMessage(): Message {
  return {
    edit: async (opts: unknown) => {
      const content =
        opts && typeof opts === "object" && "content" in opts
          ? (opts as { content: string }).content
          : String(opts);
      console.log(`[Status] ${content}`);
    },
  } as unknown as Message;
}

interface TimingData {
  sessionId: string;
  channelName?: string;
  textChannelName?: string;
  sessionStart: string;
  sessionStop?: string;
  totalDurationMs: number;
  speechSegments?: {
    userId: string;
    startMs: number;
    endMs: number;
    byteStart: number;
    byteEnd: number;
  }[];
  users: { discordId: string; startOffsetMs: number }[];
}

/** Read timing.json from a session directory. */
function readTiming(sessionPath: string): TimingData | null {
  const timingPath = join(sessionPath, "timing.json");
  if (!existsSync(timingPath)) return null;
  return JSON.parse(readFileSync(timingPath, "utf-8")) as TimingData;
}

interface UserDir {
  discordId: string;
  pcmPath: string;
  rawOggPath: string;
  snippetsDir: string;
}

/** Discover user directories with valid PCM files in a session. */
function discoverUsers(sessionPath: string): UserDir[] {
  const users: UserDir[] = [];
  for (const entry of readdirSync(sessionPath, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(sessionPath, entry.name);
    const pcmPath = join(dir, `user_${entry.name}.pcm`);
    if (!existsSync(pcmPath) || statSync(pcmPath).size === 0) continue;
    users.push({
      discordId: entry.name,
      pcmPath,
      rawOggPath: join(dir, `user_${entry.name}_raw.ogg`),
      snippetsDir: join(dir, "snippets"),
    });
  }
  return users;
}

/**
 * Reconstruct a RecordingSession from an existing session directory.
 * Prefers persisted start/stop timestamps when present so offline processing
 * uses the exact original session duration.
 */
function buildMockSession(sessionPath: string): RecordingSession {
  const absPath = resolve(sessionPath);
  const timing = readTiming(absPath);
  const userStartTimes = new Map<string, number>();
  const userIds = new Set<string>();

  if (timing) {
    for (const u of timing.users) {
      userStartTimes.set(u.discordId, u.startOffsetMs);
      userIds.add(u.discordId);
    }
  }

  // Also pick up any user dirs not in timing.json
  for (const user of discoverUsers(absPath)) {
    userIds.add(user.discordId);
    if (!userStartTimes.has(user.discordId)) {
      userStartTimes.set(user.discordId, 0);
    }
  }

  // Derive effective duration so the mock startedAt is correct
  let durationMs = timing?.totalDurationMs ?? 0;
  if (durationMs === 0) {
    const users = discoverUsers(absPath);
    const maxPcm = Math.max(...users.map((u) => statSync(u.pcmPath).size), 0);
    durationMs = (maxPcm / BYTES_PER_SECOND) * 1000;
  }

  const parsedStartedAt = timing?.sessionStart ? new Date(timing.sessionStart) : null;
  const parsedStoppedAt = timing?.sessionStop ? new Date(timing.sessionStop) : null;
  const startedAt = parsedStartedAt && !Number.isNaN(parsedStartedAt.getTime())
    ? parsedStartedAt
    : parsedStoppedAt && !Number.isNaN(parsedStoppedAt.getTime())
      ? new Date(parsedStoppedAt.getTime() - durationMs)
      : new Date(Date.now() - durationMs);
  const stoppedAt = parsedStoppedAt && !Number.isNaN(parsedStoppedAt.getTime())
    ? parsedStoppedAt
    : new Date(startedAt.getTime() + durationMs);

  return {
    id: timing?.sessionId ?? basename(absPath),
    guildId: "test-guild",
    channelId: "test-channel",
    channelName: timing?.channelName ?? "",
    textChannelName: timing?.textChannelName,
    startedAt,
    stoppedAt,
    startedBy: "test-user",
    connection: null as never,
    userStreams: new Map(),
    userAudioStates: new Map(),
    userIds,
    userStartTimes,
    speechSegments: timing?.speechSegments ?? [],
    sessionPath: absPath,
    debugLogPath: null,
    debugLogStream: null,
    debugMergedFd: null,
    lastVoiceActivityAt: stoppedAt.getTime(),
    maxDurationTimeout: null,
    starterAbsentTimeout: null,
    botAloneTimeout: null,
    inactivityMonitorInterval: null,
    receiver: null,
    isStopping: false,
    autoStopInProgress: false,
  };
}

/** Decode OGG to PCM via ffmpeg (for verify-snippets; no production equivalent). */
function decodeOggToPcm(oggPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-i", oggPath,
      "-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS),
      "-loglevel", "error",
      "pipe:1",
    ]);
    const chunks: Buffer[] = [];
    proc.stdout.on("data", (d: Buffer) => chunks.push(d));
    let stderr = "";
    proc.stderr.on("data", (d: Buffer) => {
      stderr += d.toString();
    });
    proc.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(chunks));
      reject(new Error(`ffmpeg decode failed (code ${code}): ${stderr}`));
    });
    proc.on("error", (err) =>
      reject(new Error(`Failed to spawn ffmpeg: ${err.message}`)),
    );
  });
}

// ─── Operations ──────────────────────────────────────────────────────────────

/**
 * Full pipeline — calls the real processRecording with a mock session/message.
 * WARNING: Overwrites merged.ogg, transcript.txt, summary.json in the session dir.
 */
async function opProcess(sessionPath: string): Promise<void> {
  console.log(
    "WARNING: This overwrites merged.ogg, transcript.txt, and summary.json\n",
  );
  const session = buildMockSession(sessionPath);
  const message = createMockMessage();
  const result = await processRecording(session, message);
  console.log("\nProcessing complete:");
  console.log(`  Merged audio: ${result.mergedAudioPath}`);
  console.log(`  Transcript:   ${result.transcriptPath}`);
  console.log(`  Summary:      ${result.summaryPath}`);
  console.log(`  Users:        ${result.userCount}`);
  console.log(`  Duration:     ${result.duration}s`);
}

/**
 * Transcript only — uses snippet-based ElevenLabs transcription.
 * Output goes to a timestamped file.
 */
async function opTranscript(sessionPath: string): Promise<void> {
  const absPath = resolve(sessionPath);
  const users = discoverUsers(absPath);
  if (users.length === 0) fatal("No user audio found");

  console.log("Using transcription provider: elevenlabs");

  const timing = readTiming(absPath);

  // Use speech segments from timing.json, fall back to filesystem discovery
  const speechSegments =
    timing?.speechSegments && timing.speechSegments.length > 0
      ? timing.speechSegments
      : discoverSegmentsFromFilesystem(absPath);

  if (speechSegments.length === 0) {
    fatal("No speech segments found (no snippets in timing.json or on disk)");
  }

  console.log(`Found ${speechSegments.length} speech segments`);

  const userNames = await loadSessionUserNames(
    absPath,
    speechSegments.map((segment) => segment.userId),
  );

  resetSessionTranscribedSegments(absPath);
  const transcribedSegmentCount = await transcribeSnippetsOffline(
    absPath,
    speechSegments,
  );
  const allSegments = readSessionTranscribedSegments(absPath);

  const transcript = createChronologicalTranscript(allSegments, userNames);
  const outputPath = getTranscriptOutputPath(absPath);
  writeFileSync(outputPath, transcript, "utf-8");
  const deletedSnippetWavCount = cleanupSessionSnippetWavs(absPath);
  console.log(
    `\nCreated ${basename(outputPath)} (${transcribedSegmentCount} segments from ${speechSegments.length} snippets)`,
  );
  if (deletedSnippetWavCount > 0) {
    console.log(`Removed ${deletedSnippetWavCount} snippet WAV file(s) after transcript regeneration`);
  }
}

/**
 * Summary only — calls real generateSummary on the most recent transcript.
 * Output goes to a timestamped file.
 */
async function opSummary(sessionPath: string): Promise<void> {
  const absPath = resolve(sessionPath);
  const timing = readTiming(absPath);
  const transcriptFiles = readdirSync(absPath)
    .filter((f) => f.startsWith("transcript") && f.endsWith(".txt"))
    .sort()
    .reverse();

  if (transcriptFiles.length === 0) {
    fatal("No transcript file found. Run the 'transcript' operation first.");
  }

  const transcriptPath = join(absPath, transcriptFiles[0]);
  console.log(`Using transcript: ${transcriptFiles[0]}`);
  const transcriptContent = readFileSync(transcriptPath, "utf-8");
  const userNames = await loadSessionUserNames(absPath);
  const participants: SummaryParticipant[] = [...userNames.entries()].map(
    ([discordId, userName]) => ({
      discordId,
      userName,
    }),
  );

  console.log("Generating summary...");
  const generatedSummary = await generateSummary(
    transcriptContent,
    absPath,
    buildSummaryContext(
      absPath,
      timing?.channelName,
      timing?.textChannelName,
      userNames,
    ),
  );

  const outputPath = join(absPath, `summary_${fileSuffix()}.json`);
  const storedSummary = createStoredSessionSummary({
    sessionId: basename(absPath),
    title: generatedSummary.title,
    summary: generatedSummary.summary,
    channelName: timing?.channelName,
    textChannelName: timing?.textChannelName,
    durationSeconds: Math.floor((timing?.totalDurationMs ?? 0) / 1000),
    participants,
  });
  writeFileSync(outputPath, `${JSON.stringify(storedSummary, null, 2)}\n`, "utf-8");
  console.log(`Created ${basename(outputPath)}`);
}

/**
 * Verify snippets — compares concatenated snippet PCMs against the raw OGG decode.
 * (Standalone utility — no production code equivalent exists for this comparison.)
 */
async function opVerifySnippets(sessionPath: string): Promise<void> {
  const users = discoverUsers(resolve(sessionPath));
  if (users.length === 0) fatal("No user audio found");

  let allPassed = true;

  for (const user of users) {
    console.log(`\n── User ${user.discordId} ──`);

    if (!existsSync(user.rawOggPath)) {
      console.log("  SKIP: no raw OGG file");
      continue;
    }
    if (!existsSync(user.snippetsDir)) {
      console.log("  SKIP: no snippets directory");
      continue;
    }

    console.log("  Decoding OGG → PCM via ffmpeg...");
    const oggPcm = await decodeOggToPcm(user.rawOggPath);
    console.log(
      `  OGG decoded: ${oggPcm.length} bytes (${(oggPcm.length / BYTES_PER_SECOND).toFixed(2)}s)`,
    );

    const snippetFiles = readdirSync(user.snippetsDir)
      .filter((f) => f.startsWith("temp_") && f.endsWith(".pcm"))
      .map((f) => {
        const m = f.match(/^temp_(\d+)\.pcm$/);
        return m ? { file: f, startMs: parseInt(m[1], 10) } : null;
      })
      .filter((s): s is { file: string; startMs: number } => s !== null)
      .sort((a, b) => a.startMs - b.startMs);

    if (snippetFiles.length === 0) {
      console.log("  SKIP: no snippet PCM files");
      continue;
    }

    const snippetsCombined = Buffer.concat(
      snippetFiles.map((s) => readFileSync(join(user.snippetsDir, s.file))),
    );
    console.log(
      `  Snippets: ${snippetFiles.length} files, ${snippetsCombined.length} bytes (${(snippetsCombined.length / BYTES_PER_SECOND).toFixed(2)}s)`,
    );

    const sizeDiff = Math.abs(oggPcm.length - snippetsCombined.length);
    if (oggPcm.length === snippetsCombined.length) {
      let mismatches = 0;
      for (let i = 0; i < oggPcm.length; i++) {
        if (oggPcm[i] !== snippetsCombined[i]) mismatches++;
      }
      if (mismatches === 0) {
        console.log("  PASS: exact byte match");
      } else {
        console.log(
          `  WARN: same size, ${mismatches} byte diffs (${((mismatches / oggPcm.length) * 100).toFixed(2)}%)`,
        );
        allPassed = false;
      }
    } else {
      console.log(
        `  DIFF: size mismatch — OGG ${oggPcm.length} vs snippets ${snippetsCombined.length} (delta ${sizeDiff} / ${(sizeDiff / BYTES_PER_SECOND).toFixed(3)}s)`,
      );
      const minLen = Math.min(oggPcm.length, snippetsCombined.length);
      const checkLen = Math.min(minLen, 1024 * 1024);
      let mismatches = 0;
      for (let i = 0; i < checkLen; i++) {
        if (oggPcm[i] !== snippetsCombined[i]) mismatches++;
      }
      console.log(
        `  Overlap check (first ${(checkLen / 1024).toFixed(0)}KB): ${((mismatches / checkLen) * 100).toFixed(2)}% bytes differ`,
      );
      allPassed = false;
    }
  }

  console.log(
    allPassed ? "\nAll users passed." : "\nSome users had differences.",
  );
  process.exitCode = allPassed ? 0 : 1;
}

/**
 * Merge — calls real mergeSessionAudio to build merged audio from aligned
 * per-user session tracks without reconstructing the session in memory.
 */
async function opMerge(sessionPath: string): Promise<void> {
  const absPath = resolve(sessionPath);
  const outputPrefix = `merged_${fileSuffix()}`;
  const result = await mergeSessionAudio(absPath, outputPrefix);
  console.log(
    `\nDone: ${result.trackCount} track(s) → ${result.totalDurationSec.toFixed(1)}s`,
  );
  console.log(`  OGG: ${basename(result.audioPath)}`);
  console.log(`  Snippets seen: ${result.snippetCount}`);
  console.log(`  Snippet warnings: ${result.snippetWarningCount}`);
}

/**
 * Merge snippets — reconstructs the merged session from snippet PCM files using
 * bounded in-memory windows so long sessions can still be processed offline.
 */
async function opMergeSnippets(sessionPath: string): Promise<void> {
  const absPath = resolve(sessionPath);
  const outputPrefix = `merged_snippets_${fileSuffix()}`;
  const result = await mergeSnippetsToAudio(absPath, outputPrefix);
  console.log(
    `\nDone: ${result.snippetCount} snippet(s) → ${result.totalDurationSec.toFixed(1)}s`,
  );
  console.log(`  PCM: ${basename(result.pcmPath)}`);
  console.log(`  WAV: ${basename(result.wavPath)}`);
  console.log(`  OGG: ${basename(result.audioPath)}`);
  console.log(`  Chunks: ${result.chunkCount}`);
  console.log(`  Snippet warnings: ${result.snippetWarningCount}`);
}

/**
 * Compare both merge strategies by generating timestamped outputs for each.
 */
async function opCompareMerge(sessionPath: string): Promise<void> {
  const absPath = resolve(sessionPath);
  const suffix = fileSuffix();
  const trackPrefix = `merged_tracks_${suffix}`;
  const snippetPrefix = `merged_snippets_${suffix}`;

  console.log("Running aligned-track ffmpeg mix...");
  const trackResult = await mergeSessionAudio(absPath, trackPrefix);

  console.log("\nRunning snippet reconstruction merge...");
  const snippetResult = await mergeSnippetsToAudio(absPath, snippetPrefix);

  console.log("\nComparison complete:");
  console.log(
    `  Track mix duration: ${trackResult.totalDurationSec.toFixed(1)}s (${basename(trackResult.audioPath)})`,
  );
  console.log(
    `  Snippet mix duration: ${snippetResult.totalDurationSec.toFixed(1)}s (${basename(snippetResult.pcmPath)}, ${basename(snippetResult.wavPath)}, ${basename(snippetResult.audioPath)})`,
  );
  console.log(`  Track inputs: ${trackResult.trackCount}`);
  console.log(`  Snippets used: ${snippetResult.snippetCount}`);
  console.log(`  Snippet warnings: ${snippetResult.snippetWarningCount}`);
  console.log(
    `  Duration delta: ${Math.abs(trackResult.totalDurationSec - snippetResult.totalDurationSec).toFixed(3)}s`,
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

const OPERATIONS: Record<string, (sessionPath: string) => Promise<void>> = {
  process: opProcess,
  merge: opMerge,
  "merge-snippets": opMergeSnippets,
  "compare-merge": opCompareMerge,
  "verify-snippets": opVerifySnippets,
  transcript: opTranscript,
  summary: opSummary,
};

async function main(): Promise<void> {
  const [sessionDir, operation] = process.argv.slice(2);

  if (!sessionDir || !operation) {
    console.log(
      "Usage: npx tsx scripts/reprocess-session.ts <sessionDir> <operation>\n",
    );
    console.log("Operations:");
    console.log(
      "  process          Full processRecording pipeline (overwrites originals)",
    );
    console.log(
      "  merge            Mix aligned user tracks → merged_<timestamp>.ogg",
    );
    console.log(
      "  merge-snippets   Reconstruct from snippet PCMs → merged_snippets_<timestamp>.{pcm,wav,ogg}",
    );
    console.log(
      "  compare-merge    Generate both merge strategies for side-by-side comparison",
    );
    console.log(
      "  verify-snippets  Compare snippet PCMs against raw OGG",
    );
    console.log(
      "  transcript       Regenerate transcript → transcript_<timestamp>.txt",
    );
    console.log(
      "  summary          Regenerate summary → summary_<timestamp>.json",
    );
    process.exit(1);
  }

  if (!existsSync(sessionDir)) fatal(`Not found: ${sessionDir}`);
  if (!(operation in OPERATIONS)) {
    fatal(
      `Unknown operation '${operation}'. Valid: ${Object.keys(OPERATIONS).join(", ")}`,
    );
  }

  console.log(`Session:   ${resolve(sessionDir)}`);
  console.log(`Operation: ${operation}`);

  if (operation === "transcript") {
    console.log("Provider:  elevenlabs\n");
    await opTranscript(sessionDir);
    return;
  }

  console.log("");

  await OPERATIONS[operation](sessionDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
