import type {
  StoredSessionSummary,
  SummaryParticipant,
} from "./recording-processing.types";

export const SESSION_SUMMARY_FILE_NAME = "summary.json";

function getStringProperty(value: unknown, propertyName: string): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const propertyValue = Reflect.get(value, propertyName);
  return typeof propertyValue === "string" ? propertyValue : null;
}

function getNumberProperty(value: unknown, propertyName: string): number | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const propertyValue = Reflect.get(value, propertyName);
  return typeof propertyValue === "number" && Number.isFinite(propertyValue)
    ? propertyValue
    : null;
}

function parseSummaryParticipants(value: unknown): SummaryParticipant[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const participants: SummaryParticipant[] = [];
  for (const item of value) {
    const discordId = getStringProperty(item, "discordId");
    const userName = getStringProperty(item, "userName");

    if (!discordId || !userName) {
      continue;
    }

    participants.push({ discordId, userName });
  }

  return participants;
}

export function createStoredSessionSummary(input: {
  sessionId: string;
  title: string;
  summary: string;
  channelName?: string;
  durationSeconds: number;
  participants: SummaryParticipant[];
}): StoredSessionSummary {
  return {
    version: 1,
    sessionId: input.sessionId,
    title: input.title.trim(),
    summary: input.summary.trim(),
    channelName: input.channelName?.trim() || undefined,
    durationSeconds: Math.max(0, Math.floor(input.durationSeconds)),
    participantCount: input.participants.length,
    participants: input.participants,
    generatedAt: new Date().toISOString(),
  };
}

export function parseStoredSessionSummary(rawJson: string): StoredSessionSummary | null {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    const sessionId = getStringProperty(parsed, "sessionId");
    const title = getStringProperty(parsed, "title");
    const summary = getStringProperty(parsed, "summary");
    const durationSeconds = getNumberProperty(parsed, "durationSeconds");
    const participantCount = getNumberProperty(parsed, "participantCount");
    const generatedAt = getStringProperty(parsed, "generatedAt");
    const version = getNumberProperty(parsed, "version");

    if (!sessionId || !title || !summary || durationSeconds === null) {
      return null;
    }

    const participants = parseSummaryParticipants(
      typeof parsed === "object" && parsed !== null
        ? Reflect.get(parsed, "participants")
        : undefined,
    );
    const channelName = getStringProperty(parsed, "channelName") ?? undefined;

    return {
      version: version === 1 ? 1 : 1,
      sessionId,
      title,
      summary,
      channelName,
      durationSeconds,
      participantCount: participantCount ?? participants.length,
      participants,
      generatedAt: generatedAt ?? new Date(0).toISOString(),
    };
  } catch {
    return null;
  }
}

