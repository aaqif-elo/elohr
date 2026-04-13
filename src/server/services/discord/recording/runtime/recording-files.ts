import { once } from "events";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import type { WriteStream } from "fs";
import { join } from "path";
import {
  alignToFrame,
  buildWavHeader,
  BYTES_PER_SECOND,
  FRAME_ALIGNMENT,
  ZERO_BUFFER,
} from "../shared/audio-format";
import { getSessionDurationMs } from "./recording-session.store";
import type { RecordingSession, SessionTimingMetadata } from "./recording-types";

export function writeSessionTimingMetadata(session: RecordingSession): void {
  const stoppedAt = session.stoppedAt ?? new Date();
  const users = Array.from(session.userStartTimes.entries())
    .map(([discordId, startOffsetMs]) => ({ discordId, startOffsetMs }))
    .sort((left, right) => {
      if (left.startOffsetMs !== right.startOffsetMs) {
        return left.startOffsetMs - right.startOffsetMs;
      }

      return left.discordId.localeCompare(right.discordId);
    });
  const speechSegments = [...session.speechSegments].sort((left, right) => {
    if (left.startMs !== right.startMs) {
      return left.startMs - right.startMs;
    }

    if (left.userId !== right.userId) {
      return left.userId.localeCompare(right.userId);
    }

    return left.byteStart - right.byteStart;
  });

  const timingMetadata: SessionTimingMetadata = {
    sessionId: session.id,
    channelName: session.channelName,
    textChannelName: session.textChannelName,
    sessionStart: session.startedAt.toISOString(),
    sessionStop: stoppedAt.toISOString(),
    totalDurationMs: getSessionDurationMs(session),
    users,
    speechSegments,
  };

  writeFileSync(
    join(session.sessionPath, "timing.json"),
    JSON.stringify(timingMetadata, null, 2),
    "utf-8",
  );
}

async function writeBufferToStream(
  writable: WriteStream,
  chunk: Buffer,
): Promise<void> {
  if (writable.write(chunk)) {
    return;
  }

  await once(writable, "drain");
}

async function pipeReadableToWritableWithoutEnding(
  readable: NodeJS.ReadableStream,
  writable: WriteStream,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      readable.removeListener("end", handleEnd);
      readable.removeListener("error", handleError);
      writable.removeListener("error", handleError);
      reject(error);
    };

    const handleEnd = () => {
      readable.removeListener("error", handleError);
      writable.removeListener("error", handleError);
      resolve();
    };

    readable.once("error", handleError);
    writable.once("error", handleError);
    readable.once("end", handleEnd);
    readable.pipe(writable, { end: false });
  });
}

async function endWritableStream(writable: WriteStream): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    if (writable.destroyed || writable.writableFinished) {
      resolve();
      return;
    }

    writable.once("finish", resolve);
    writable.once("error", reject);
    writable.end();
  });
}

async function appendSilenceToStream(
  writable: WriteStream,
  byteCount: number,
): Promise<void> {
  const silenceBytes = alignToFrame(Math.max(0, byteCount));
  let bytesWritten = 0;

  while (bytesWritten < silenceBytes) {
    const chunkSize = Math.min(ZERO_BUFFER.length, silenceBytes - bytesWritten);
    await writeBufferToStream(writable, ZERO_BUFFER.subarray(0, chunkSize));
    bytesWritten += chunkSize;
  }
}

async function convertPcmTrackToWav(
  pcmPath: string,
  wavPath: string,
  fileName: string,
  targetTrackByteLength: number,
): Promise<void> {
  const pcmSize = alignToFrame(statSync(pcmPath).size);
  if (pcmSize < FRAME_ALIGNMENT) {
    return;
  }

  const outputTrackByteLength = Math.max(targetTrackByteLength, pcmSize);
  const trailingSilence = outputTrackByteLength - pcmSize;
  const wavStream = createWriteStream(wavPath, { flags: "w" });

  try {
    await writeBufferToStream(wavStream, buildWavHeader(outputTrackByteLength));
    await pipeReadableToWritableWithoutEnding(createReadStream(pcmPath), wavStream);

    if (trailingSilence > 0) {
      await appendSilenceToStream(wavStream, trailingSilence);
      console.log(
        `Padded ${fileName} with ${trailingSilence} bytes (~${(trailingSilence / BYTES_PER_SECOND).toFixed(1)}s) of trailing silence`,
      );
    } else if (pcmSize > targetTrackByteLength) {
      console.warn(
        `${fileName} exceeded the expected session length by ${pcmSize - targetTrackByteLength} bytes; preserving the longer track in WAV export`,
      );
    }

    await endWritableStream(wavStream);

    const durationSecs = outputTrackByteLength / BYTES_PER_SECOND;
    console.log(
      `Converted ${fileName} -> ${fileName.replace(".pcm", ".wav")} (${durationSecs.toFixed(1)}s)`,
    );
  } catch (error) {
    wavStream.destroy();
    throw error;
  }
}

export async function convertSessionPcmToWav(
  sessionPath: string,
  targetTrackByteLength: number,
): Promise<void> {
  try {
    const pcmPaths: Array<{
      fileName: string;
      pcmPath: string;
      wavPath: string;
    }> = [];

    const entries = readdirSync(sessionPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const userDir = join(sessionPath, entry.name);
      const userFiles = readdirSync(userDir).filter(
        (fileName) => fileName.endsWith(".pcm") && fileName.startsWith("user_"),
      );

      for (const fileName of userFiles) {
        pcmPaths.push({
          fileName,
          pcmPath: join(userDir, fileName),
          wavPath: join(userDir, fileName.replace(".pcm", ".wav")),
        });
      }
    }

    for (const pcmFile of pcmPaths) {
      try {
        await convertPcmTrackToWav(
          pcmFile.pcmPath,
          pcmFile.wavPath,
          pcmFile.fileName,
          targetTrackByteLength,
        );
      } catch (error) {
        console.error(`Failed to convert ${pcmFile.fileName} to WAV:`, error);
      }
    }

    // Convert the session-level debug merged PCM to WAV if it exists
    const mergedPcmPath = join(sessionPath, "merged_debug.pcm");
    if (existsSync(mergedPcmPath) && statSync(mergedPcmPath).size > 0) {
      try {
        await convertPcmTrackToWav(
          mergedPcmPath,
          join(sessionPath, "merged_debug.wav"),
          "merged_debug.pcm",
          targetTrackByteLength,
        );
      } catch (error) {
        console.error("Failed to convert merged_debug.pcm to WAV:", error);
      }
    }
  } catch (error) {
    console.error("Failed to convert PCM files to WAV:", error);
  }
}