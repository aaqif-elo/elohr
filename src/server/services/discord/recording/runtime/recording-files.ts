import { writeFileSync } from "fs";
import { join } from "path";
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
