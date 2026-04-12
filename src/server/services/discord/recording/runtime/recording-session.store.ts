import type { RecordingSession } from "./recording-types";

const activeSessions = new Map<string, RecordingSession>();
const SESSION_ID_REGEX =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2})-(?<minute>\d{2})-(?<second>\d{2})_(?<random>[a-z0-9]{6})$/;

export function isSessionId(value: string): boolean {
  return SESSION_ID_REGEX.test(value);
}

export function getSessionIdCreatedAt(sessionId: string): Date | null {
  const match = SESSION_ID_REGEX.exec(sessionId);
  if (!match?.groups) {
    return null;
  }

  const {
    year,
    month,
    day,
    hour,
    minute,
    second,
  } = match.groups;

  const isoTimestamp = `${year}-${month}-${day}T${hour}:${minute}:${second}.000Z`;
  const createdAt = new Date(isoTimestamp);
  return Number.isNaN(createdAt.getTime()) ? null : createdAt;
}

export function getSessionDurationMs(
  session: Pick<RecordingSession, "startedAt" | "stoppedAt">,
): number {
  const sessionEndTime = session.stoppedAt?.getTime() ?? Date.now();
  return Math.max(0, sessionEndTime - session.startedAt.getTime());
}

export function createSessionId(): string {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}_${random}`;
}

export function getActiveSession(
  guildId: string,
): RecordingSession | undefined {
  return activeSessions.get(guildId);
}

export function hasActiveSession(guildId: string): boolean {
  return activeSessions.has(guildId);
}

export function setActiveSession(session: RecordingSession): void {
  activeSessions.set(session.guildId, session);
}

export function deleteActiveSession(guildId: string): void {
  activeSessions.delete(guildId);
}