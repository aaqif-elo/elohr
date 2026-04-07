import { readFileSync } from "fs";
import { join } from "path";
import * as prism from "prism-media";
import type { TransformCallback } from "stream";
import { Transform } from "stream";
import { OPUS_FRAME_DURATION_MS } from "../shared/audio-format";
import { parseOpusToc } from "../shared/opus.utils";
import { DEBUG_AUDIO } from "./recording-config";
import { writeSessionDebugLog } from "./recording-debug";
import type { RecordingSession } from "./recording-types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getDependencyNames(packageJson: unknown): Set<string> {
  const dependencyNames = new Set<string>();
  if (!isRecord(packageJson)) {
    return dependencyNames;
  }

  for (const dependencyKey of [
    "dependencies",
    "optionalDependencies",
    "devDependencies",
  ]) {
    const dependencyBucket = packageJson[dependencyKey];
    if (!isRecord(dependencyBucket)) {
      continue;
    }

    for (const dependencyName of Object.keys(dependencyBucket)) {
      dependencyNames.add(dependencyName);
    }
  }

  return dependencyNames;
}

function detectInstalledOpusBackends(): string[] {
  try {
    const packageJsonPath = join(process.cwd(), "package.json");
    const packageJsonRaw = readFileSync(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonRaw) as unknown;
    const dependencyNames = getDependencyNames(packageJson);
    const knownBackends = ["@discordjs/opus", "node-opus", "opusscript"];

    return knownBackends.filter((backendName) =>
      dependencyNames.has(backendName),
    );
  } catch {
    return [];
  }
}

function detectOpusType(): string {
  try {
    const testDecoder = new prism.opus.Decoder({
      rate: 48000,
      channels: 2,
      frameSize: 960,
    });
    const encoderName = testDecoder.encoder?.constructor?.name;
    testDecoder.destroy();

    const installedBackends = detectInstalledOpusBackends();
    const installedSummary =
      installedBackends.length > 0
        ? installedBackends.join(", ")
        : "none declared";

    if (encoderName === "OpusEncoder") {
      return `native OpusEncoder (declared backends: ${installedSummary})`;
    }

    if (
      encoderName?.toLowerCase().includes("opus") ||
      encoderName === "default"
    ) {
      return `opusscript/WebAssembly (declared backends: ${installedSummary}, encoder=${encoderName})`;
    }

    return `${encoderName || "unknown"} (declared backends: ${installedSummary})`;
  } catch (error) {
    return `error: ${error instanceof Error ? error.message : String(error)}`;
  }
}

let crashGuardInstalled = false;

export function initializeOpusDiagnostics(): string {
  const opusType = detectOpusType();
  console.log(`[Recording Service] Using Opus implementation: ${opusType}`);

  if (
    !crashGuardInstalled &&
    (opusType.includes("opusscript") || opusType.includes("WebAssembly"))
  ) {
    crashGuardInstalled = true;

    console.warn(
      "[Recording Service] WARNING: Using opusscript (WebAssembly) which is unstable!",
    );
    console.warn(
      "[Recording Service] Consider using Node.js v20 LTS for @discordjs/opus compatibility",
    );

    process.on("uncaughtException", (error) => {
      if (
        error instanceof Error &&
        (error.message.includes("Aborted()") ||
          error.message.includes("opus"))
      ) {
        console.error(
          "[Recording Service] Caught opusscript crash, continuing...",
          error.message,
        );
        return;
      }

      throw error;
    });
  }

  return opusType;
}

export function createOpusSyncFilter(
  session: RecordingSession,
  userId: string,
  onPacketSkipped?: () => void,
): Transform {
  let packetsSkipped = 0;
  let packetsProcessed = 0;
  let isSynced = false;
  let lastTocConfig = -1;
  let consecutiveSameConfig = 0;
  const warmupWindow = 20;
  const requiredConsistentConfigs = 3;

  return new Transform({
    transform(
      chunk: Buffer,
      _encoding: BufferEncoding,
      callback: TransformCallback,
    ) {
      packetsProcessed++;

      if (chunk.length < 1) {
        packetsSkipped++;
        onPacketSkipped?.();
        callback();
        return;
      }

      const tocByte = chunk[0];
      const tocInfo = parseOpusToc(tocByte);

      if (isSynced || packetsProcessed > warmupWindow) {
        if (!isSynced) {
          isSynced = true;
          writeSessionDebugLog(
            session,
            "log",
            `[DEBUG] User ${userId}: Sync filter auto-synced at packet #${packetsProcessed} (warmup exceeded, ${packetsSkipped} dropped)`,
            {
              userId,
              userTrackMs: packetsProcessed * OPUS_FRAME_DURATION_MS,
            },
          );
        }

        callback(null, chunk);
        return;
      }

      if (DEBUG_AUDIO && packetsProcessed <= 3) {
        writeSessionDebugLog(
          session,
          "log",
          `[DEBUG] User ${userId}: Startup Opus packet #${packetsProcessed} TOC=0x${tocByte.toString(16)} config=${tocInfo.config} valid=${tocInfo.isValidOpusConfig} typical=${tocInfo.isDiscordTypicalConfig}`,
          {
            userId,
            userTrackMs: packetsProcessed * OPUS_FRAME_DURATION_MS,
          },
        );
      }

      if (tocInfo.config === lastTocConfig) {
        consecutiveSameConfig++;
      } else {
        consecutiveSameConfig = 1;
        lastTocConfig = tocInfo.config;
      }

      if (consecutiveSameConfig >= requiredConsistentConfigs) {
        isSynced = true;
        writeSessionDebugLog(
          session,
          "log",
          `[DEBUG] User ${userId}: Sync filter locked on config=${lastTocConfig} at packet #${packetsProcessed} (${packetsSkipped} startup packets dropped)`,
          {
            userId,
            userTrackMs: packetsProcessed * OPUS_FRAME_DURATION_MS,
          },
        );
        callback(null, chunk);
        return;
      }

      packetsSkipped++;
      onPacketSkipped?.();

      if (DEBUG_AUDIO && packetsSkipped <= 10) {
        writeSessionDebugLog(
          session,
          "log",
          `[DEBUG] User ${userId}: Dropping unsync'd startup packet #${packetsProcessed} config=${tocInfo.config}`,
          {
            userId,
            userTrackMs: packetsProcessed * OPUS_FRAME_DURATION_MS,
          },
        );
      }

      callback();
    },
  });
}