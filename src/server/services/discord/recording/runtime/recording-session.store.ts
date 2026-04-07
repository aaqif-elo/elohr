import type { RecordingSession } from "./recording-types";

const activeSessions = new Map<string, RecordingSession>();

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