import { Meeting } from "@prisma/client";
import { db, getDiscordIdsFromUserIds } from ".";
import { discordTimestamp } from "../utils/discord";
import { attendanceEvents } from "./attendances";
import {
  Client,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
} from "discord.js";

// In-memory cache for the next reminder time to reduce DB sweeps
let nextReminderCache: { at: Date; meetingId: string } | null = null;

// Lead time in minutes for reminders (before meeting start)
const REMINDER_LEAD_MINUTES = 10;
// Typed literal for Prisma sort order without assertions
const SORT_ASC: "asc" = "asc";

type MeetingRequestEntry = Meeting["requests"][number];

// Treat reminders as "unsent" when the field is either null (explicitly not sent)
// or not set at all (older documents). This matches both cases in MongoDB.
const UNSENT_REMINDER_PREDICATE = {
  OR: [{ reminderSentAt: null }, { reminderSentAt: { isSet: false } }],
};

export function getNextReminderCache(): { at: Date; meetingId: string } | null {
  return nextReminderCache;
}

export function updateNextReminderCache(
  candidateAt: Date,
  meetingId: string
): void {
  if (!nextReminderCache || candidateAt < nextReminderCache.at) {
    nextReminderCache = { at: candidateAt, meetingId };
  }
}

export function clearNextReminderCacheIfMatches(meetingId?: string): void {
  if (!nextReminderCache) return;
  if (!meetingId || nextReminderCache.meetingId === meetingId) {
    nextReminderCache = null;
  }
}

type CreateMeetingInput = Omit<
  Meeting,
  "id" | "createdAt" | "updatedAt" | "isCanceled" | "reminderSentAt"
> & {
  isCanceled?: boolean;
  reminderSentAt?: Date | null;
};

export async function createMeeting(doc: CreateMeetingInput): Promise<Meeting> {
  const meeting = await db.meeting.create({
    data: {
      creatorUserId: doc.creatorUserId,
      channelId: doc.channelId,
      title: doc.title ?? null,
      startTime: doc.startTime,
      endTime: doc.endTime,
      durationMins: doc.durationMins,
      isCanceled: doc.isCanceled ?? false,
      requests: doc.requests,
      reminderSentAt: doc.reminderSentAt ?? null,
    },
  });

  // Update next reminder cache with this meeting's reminder time (10 minutes before start)
  const now = new Date();
  const reminderAt = new Date(
    meeting.startTime.getTime() - REMINDER_LEAD_MINUTES * 60_000
  );
  if (reminderAt > now) {
    updateNextReminderCache(reminderAt, meeting.id);
  }
  return meeting;
}

export async function updateMeeting(
  id: string,
  updates: Partial<Meeting>
): Promise<Meeting | null> {
  try {
    return await db.meeting.update({
      where: { id },
      data: updates,
    });
  } catch {
    return null;
  }
}

export async function getMeetingById(id: string): Promise<Meeting | null> {
  return await db.meeting.findUnique({ where: { id } });
}

export async function cancelMeeting(id: string): Promise<Meeting | null> {
  return updateMeeting(id, { isCanceled: true });
}

// Reminders
export async function findMeetingsDueForReminder(
  now = new Date()
): Promise<Meeting[]> {
  // Reminder triggers within 10 minutes of the meeting start time. We include
  // all meetings starting between now and now+10m, not yet sent, to recover after restarts.
  const targetEnd = new Date(now.getTime() + REMINDER_LEAD_MINUTES * 60_000);
  return await db.meeting.findMany({
    where: {
      isCanceled: false,
  ...UNSENT_REMINDER_PREDICATE,
      startTime: { gte: now, lte: targetEnd },
    },
  });
}

export async function markReminderSent(
  meetingId: string,
  when = new Date()
): Promise<void> {
  await db.meeting.update({
    where: { id: meetingId },
    data: { reminderSentAt: when },
  });
  clearNextReminderCacheIfMatches(meetingId);
}

export async function findNextMeetingForReminder(
  now = new Date()
): Promise<Meeting | null> {
  return await db.meeting.findFirst({
    where: {
      isCanceled: false,
  ...UNSENT_REMINDER_PREDICATE,
      startTime: { gte: now },
    },
    orderBy: { startTime: SORT_ASC },
  });
}

enum MEETING_BUTTON_IDS {
  ACCEPT = "mtg-accept",
  REJECT = "mtg-reject",
}

export async function sendMeetingInviteDM(
  discordClient: Client<boolean>,
  userDiscordId: string,
  meeting: Meeting
): Promise<void> {
  try {
    const discordUser = await discordClient.users.fetch(userDiscordId);
    // Resolve inviter's discord ID (creatorUserId -> discordId)
    let inviterMention = "someone";
    try {
      const mappings = await getDiscordIdsFromUserIds([meeting.creatorUserId]);
      if (mappings.length && mappings[0].discordId) {
        inviterMention = `<@${mappings[0].discordId}>`;
      }
    } catch {
      // ignore mapping errors; fallback text
    }
    // Channel mention
    const channelMention = `<#${meeting.channelId}>`;
    const accept = new ButtonBuilder()
      .setCustomId(`${MEETING_BUTTON_IDS.ACCEPT}-${meeting.id}`)
      .setLabel("Accept")
      .setStyle(ButtonStyle.Success)
      .setEmoji("✅");
    const reject = new ButtonBuilder()
      .setCustomId(`${MEETING_BUTTON_IDS.REJECT}-${meeting.id}`)
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
      .setEmoji("❌");
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      accept,
      reject
    );
    const when = `${discordTimestamp(meeting.startTime, "F")} (${meeting.durationMins} mins, ${discordTimestamp(meeting.startTime, "R")})`;
    await discordUser.send({
      content: `${inviterMention} is inviting you to a meeting${
        meeting.title ? `: **${meeting.title}**` : ""
      } in ${channelMention} on ${when}. Do you accept?`,
      components: [row],
    });
  } catch (e) {
    console.error("Failed to send meeting DM:", e);
  }
}

export async function notifyMeetingReminder(
  discordClient: Client<boolean>,
  meeting: Meeting
) {
  // DM accepted users and mention in channel
  const acceptedUserIds = meeting.requests
    .filter((request) => !!request.requestAcceptedAt && !request.rejectedAt)
    .map((request) => request.userId);
  const discordMappings = await getDiscordIdsFromUserIds(acceptedUserIds);
  const mentionList = discordMappings.map((m) => `<@${m.discordId}>`).join(" ");

  for (const mapping of discordMappings) {
    try {
      const user = await discordClient.users.fetch(mapping.discordId);
      await user.send(`Reminder: Your meeting${
        meeting.title ? ` "${meeting.title}"` : ""
      } starts at ${discordTimestamp(meeting.startTime, "t")} (${discordTimestamp(meeting.startTime, "R")}).`);
    } catch (e) {
      console.error("Failed to DM meeting reminder:", e);
    }
  }
  try {
    const channel = await discordClient.channels.fetch(meeting.channelId);
    if (channel && channel.type === ChannelType.GuildText) {
      channel.send({
        content: `${mentionList} Reminder: Meeting${
          meeting.title ? ` "${meeting.title}"` : ""
        } starts at ${discordTimestamp(meeting.startTime, "t")} (${discordTimestamp(meeting.startTime, "R")}).`,
      });
    }
  } catch (e) {
    console.error("Failed to post meeting reminder:", e);
  }
}

// Button handlers helpers
export async function setMeetingRequestAcceptance(
  meetingId: string,
  userId: string,
  accepted: boolean
): Promise<Meeting | null> {
  // Read-modify-write since Prisma doesn't support positional updates on nested arrays for Mongo yet
  const existingMeeting = await db.meeting.findUnique({
    where: { id: meetingId },
  });
  if (!existingMeeting) return null;

  const now = new Date();
  const updatedRequests: MeetingRequestEntry[] = existingMeeting.requests.map(
    (request) =>
      request.userId === userId
        ? {
            ...request,
            requestAcceptedAt: accepted ? now : null,
            rejectedAt: accepted ? null : now,
          }
        : request
  );
  return await db.meeting.update({
    where: { id: meetingId },
    data: { requests: updatedRequests },
  });
}

export async function everyoneRejected(meeting: Meeting): Promise<boolean> {
  // true if all have rejectedAt and none have requestAcceptedAt
  const hasAnyAccepted = meeting.requests.some(
    (req) => !!req.requestAcceptedAt
  );
  const allRejected =
    meeting.requests.length > 0 &&
    meeting.requests.every((req) => !!req.rejectedAt);
  return allRejected && !hasAnyAccepted;
}

// Attendance hook: mark attended if a user is working during meeting time window
attendanceEvents.on("attendanceUpdated", async (attendance) => {
  try {
    const now = new Date();
    // Find overlapping active meetings where this user is invited
    const overlappingMeetings = await db.meeting.findMany({
      where: {
        isCanceled: false,
        startTime: { lte: now },
        endTime: { gte: now },
        requests: {
          some: { userId: attendance.userId },
        },
      },
    });
    if (!overlappingMeetings.length) return;

    // If user has an active work segment overlapping meeting time, mark attended=true
    const lastSegment =
      attendance.workSegments[attendance.workSegments.length - 1];
    const isWorking =
      !!lastSegment && (!lastSegment.end || lastSegment.end > now);
    if (!isWorking) return;

    for (const meetingRecord of overlappingMeetings) {
      const updatedRequests: MeetingRequestEntry[] = meetingRecord.requests.map(
        (request) =>
          request.userId === attendance.userId && !request.attended
            ? { ...request, attended: true }
            : request
      );

      const hasChanges = updatedRequests.some(
        (req, idx) => req !== meetingRecord.requests[idx]
      );
      if (hasChanges) {
        await db.meeting.update({
          where: { id: meetingRecord.id },
          data: { requests: updatedRequests },
        });
      }
    }
  } catch (e) {
    console.error("Meeting attendance hook error:", e);
  }
});
