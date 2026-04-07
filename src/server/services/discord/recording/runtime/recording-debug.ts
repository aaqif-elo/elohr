import {
  DEBUG_AUDIO,
  OPUS_PACKET_DEBUG_BYTES,
  OPUS_PACKET_DEBUG_RING_SIZE,
} from "./recording-config";
import type {
  BackpressureTarget,
  ChunkWritable,
  DebugLogDetails,
  DebugLogLevel,
  OpusPacketDebugInfo,
  RecordingSession,
  StreamBackpressureState,
  UserAudioState,
} from "./recording-types";

export function isCorruptedFrame(chunk: Buffer): boolean {
  if (chunk.length < 16) {
    return false;
  }

  const checkLength = Math.min(64, chunk.length);
  const firstByte = chunk[0];

  if (firstByte !== 0) {
    let isUniform = true;
    for (let index = 1; index < Math.min(32, chunk.length); index++) {
      if (chunk[index] !== firstByte) {
        isUniform = false;
        break;
      }
    }

    if (isUniform) {
      const firstSample = chunk.readInt16LE(0);
      if (Math.abs(firstSample) > 1000) {
        return true;
      }
    }
  }

  let allMax = true;
  for (let index = 0; index < checkLength - 1; index += 2) {
    if (chunk.readInt16LE(index) !== 0x7fff) {
      allMax = false;
      break;
    }
  }
  if (allMax) {
    return true;
  }

  if (chunk.length >= 32) {
    const pattern16 = chunk.readUInt16LE(0);
    const patternSigned = chunk.readInt16LE(0);
    const isMeaningful =
      pattern16 > 0x0010 &&
      pattern16 < 0xfff0 &&
      Math.abs(patternSigned) > 1000;

    if (isMeaningful) {
      let isRepeating = true;
      for (let index = 2; index < 32; index += 2) {
        if (chunk.readUInt16LE(index) !== pattern16) {
          isRepeating = false;
          break;
        }
      }

      if (isRepeating) {
        return true;
      }
    }
  }

  if (chunk.length >= 32) {
    let clippedSamples = 0;
    const checkSamples = Math.min(Math.floor(chunk.length / 2), 64);

    for (let index = 0; index < checkSamples * 2; index += 2) {
      const sample = chunk.readInt16LE(index);
      if (Math.abs(sample) > 32000) {
        clippedSamples++;
      }
    }

    if (clippedSamples > checkSamples * 0.75) {
      return true;
    }
  }

  return false;
}

export function createPacketPrefixHex(packet: Buffer): string {
  const prefix = packet.subarray(0, OPUS_PACKET_DEBUG_BYTES);
  const groupedHex = prefix.toString("hex").match(/.{1,4}/g)?.join(" ");
  return groupedHex ?? "(empty packet)";
}

export function getUserAudioTimestampMs(state: UserAudioState): number {
  return state.sessionAudioCursorMs;
}

export function writeSessionDebugLog(
  session: RecordingSession,
  logLevel: DebugLogLevel,
  message: string,
  details: DebugLogDetails = {},
): void {
  if (logLevel === "warn") {
    console.warn(message);
  } else if (logLevel === "error") {
    console.error(message);
  } else {
    console.log(message);
  }

  const debugLogStream = session.debugLogStream;
  if (!debugLogStream) {
    return;
  }

  const wallClockIso = new Date().toISOString();
  const sessionAudioMs = Math.max(
    0,
    Math.round(
      details.sessionAudioMs ?? (Date.now() - session.startedAt.getTime()),
    ),
  );
  const userIdSegment = details.userId ? ` user=${details.userId}` : "";
  const userTrackSegment =
    details.userTrackMs === undefined
      ? ""
      : ` userAudioMs=${Math.max(0, Math.round(details.userTrackMs))}`;

  debugLogStream.write(
    `${wallClockIso} level=${logLevel} sessionAudioMs=${sessionAudioMs}${userIdSegment}${userTrackSegment} ${message}\n`,
  );
}

export function markBackpressure(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
  target: BackpressureTarget,
  tracking: StreamBackpressureState,
): void {
  tracking.totalEvents++;

  if (tracking.active) {
    return;
  }

  tracking.active = true;

  if (DEBUG_AUDIO) {
    writeSessionDebugLog(
      session,
      "warn",
      `[DEBUG] User ${userId}: ${target} stream backpressure started`,
      {
        userId,
        userTrackMs: getUserAudioTimestampMs(state),
      },
    );
  }
}

export function clearBackpressure(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
  target: BackpressureTarget,
  tracking: StreamBackpressureState,
): void {
  if (!tracking.active) {
    return;
  }

  tracking.active = false;

  if (DEBUG_AUDIO) {
    writeSessionDebugLog(
      session,
      "log",
      `[DEBUG] User ${userId}: ${target} stream drained`,
      {
        userId,
        userTrackMs: getUserAudioTimestampMs(state),
      },
    );
  }
}

export function writeChunkToWritable(
  writable: ChunkWritable,
  chunk: Buffer,
  onBackpressure?: () => void,
): void {
  if (!writable.write(chunk)) {
    onBackpressure?.();
  }
}

export function pushRecentOpusPacket(
  state: UserAudioState,
  packetInfo: OpusPacketDebugInfo,
): void {
  state.recentOpusPackets.push(packetInfo);
  if (state.recentOpusPackets.length > OPUS_PACKET_DEBUG_RING_SIZE) {
    state.recentOpusPackets.shift();
  }
}

export function logRecentOpusContext(
  session: RecordingSession,
  userId: string,
  state: UserAudioState,
  reason: string,
): void {
  const userTrackMs = getUserAudioTimestampMs(state);

  if (state.recentOpusPackets.length === 0) {
    writeSessionDebugLog(
      session,
      "warn",
      `[DEBUG] User ${userId}: ${reason}. No recent Opus packet context available.`,
      { userId, userTrackMs },
    );
    return;
  }

  writeSessionDebugLog(
    session,
    "warn",
    `[DEBUG] User ${userId}: ${reason}. Recent Opus packet context (${state.recentOpusPackets.length} packets):`,
    { userId, userTrackMs },
  );

  for (const packetInfo of state.recentOpusPackets) {
    writeSessionDebugLog(
      session,
      "warn",
      `[DEBUG]   #${packetInfo.sequence} t=${packetInfo.receivedAtMs}ms len=${packetInfo.packetLengthBytes} TOC=0x${packetInfo.tocByte.toString(16)} cfg=${packetInfo.tocConfig} stereo=${packetInfo.tocStereo} frames=${packetInfo.tocFrameCount} hex=${packetInfo.packetPrefixHex}`,
      {
        userId,
        userTrackMs: packetInfo.receivedAtMs,
      },
    );
  }
}