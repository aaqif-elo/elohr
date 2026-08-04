import { EAttendanceCommands } from "./discord.enums";
import type { VoiceState } from "discord.js";
import { getGuildMember } from ".";
import {
  hasActiveWorkSegment,
  startWorkSegment,
  endWorkSegment,
  getUserByDiscordId,
  getProjectByChannelId,
  getWorkSegmentDescription,
  updateUserAvatar,
} from "../../db";
import type { User } from "@prisma/client";
import { formatWorkedDuration } from "../../utils/time";
import { buildDescriptionButton } from "./interaction-handlers/worksegment-description.handler";

const DESCRIPTION_MIN_SEGMENT_MS = 10 * 60 * 1000;
const DESCRIPTION_REMINDER_DELAY_MS =
  (Number(process.env.WORK_SEGMENT_DESCRIPTION_REMINDER_MINUTES) || 30) *
  60 *
  1000;

if (!process.env.VOICE_CHANNEL_ATTENDANCE_DELAY_IN_SECONDS)
  throw new Error("VOICE_CHANNEL_ATTENDANCE_DELAY_IN_SECONDS is not defined");

const ATTENDANCE_DELAY_IN_SECONDS = parseInt(
  process.env.VOICE_CHANNEL_ATTENDANCE_DELAY_IN_SECONDS
);

const pendingTimeouts: Record<string, NodeJS.Timeout> = {};
const userActionQueues: Record<string, Array<() => Promise<void>>> = {};
const userActionInProgress: Record<string, boolean> = {};

const processNextAction = async (userId: string) => {
  if (userActionInProgress[userId] || !userActionQueues[userId] || userActionQueues[userId].length === 0) {
    return;
  }

  userActionInProgress[userId] = true;
  const actionToExecute = userActionQueues[userId].shift();

  if (actionToExecute) {
    try {
      await actionToExecute();
    } catch (error) {
      console.error(`Error executing action for user ${userId}:`, error);
    } finally {
      userActionInProgress[userId] = false;
      processNextAction(userId);
    }
  } else {
    userActionInProgress[userId] = false;
  }
};

type NotifyCallback = (msg: string, userDiscordId: string) => void;

// Refresh the stored avatar from the live guild member (fire-and-forget).
const refreshAvatarFromGuild = (user: User) => {
  getGuildMember(user.discordInfo.id)
    .then((member) => {
      if (
        member?.user.avatar &&
        member.user.avatar !== user.discordInfo.avatar
      ) {
        updateUserAvatar(user.id, member.user.avatar).catch((err) =>
          console.error("Error updating avatar:", err)
        );
      }
    })
    .catch((err) =>
      console.error("Error getting guild member for avatar update:", err)
    );
};

// Open a new work segment on `projectName`. Notifies the user and returns false
// if a segment couldn't be started (e.g. one is already open).
const startWorkForUser = async (
  user: User,
  projectName: string,
  notify: NotifyCallback
): Promise<boolean> => {
  const result = await startWorkSegment(user.id, projectName);
  if (typeof result === "string") {
    notify(`${process.env.STATUS_TAG_ERROR} ${result}`, user.discordInfo.id);
    return false;
  }
  refreshAvatarFromGuild(user);
  return true;
};

// DM the user a summary of their just-ended segment with an "add description"
// button, then schedule a single gentle reminder if it's still blank later.
const promptForSegmentDescription = (payload: {
  user: User;
  attendanceId: string;
  segmentStartMs: number;
  projectName: string;
  summary: string;
}) => {
  const { user, attendanceId, segmentStartMs, projectName, summary } = payload;

  getGuildMember(user.discordInfo.id)
    .then((member) =>
      member?.send({
        content: `${summary}\n\nMind adding a quick note on what you worked on?`,
        components: [buildDescriptionButton(attendanceId, segmentStartMs)],
      })
    )
    .catch((err) => console.error("Error sending work segment DM:", err));

  setTimeout(() => {
    void (async () => {
      try {
        const { found, description } = await getWorkSegmentDescription(
          attendanceId,
          segmentStartMs
        );
        // Skip the reminder if the segment is gone or already described.
        if (!found || description) return;

        const member = await getGuildMember(user.discordInfo.id);
        await member?.send({
          content: `👋 Quick reminder: your earlier work segment on **${projectName}** still has no description. No worries if you'd rather skip it.`,
          components: [buildDescriptionButton(attendanceId, segmentStartMs)],
        });
      } catch (err) {
        console.error("Error sending description reminder:", err);
      }
    })();
  }, DESCRIPTION_REMINDER_DELAY_MS);
};

// Close the user's open work segment, DMing a summary for segments >= 10 min.
// Returns the formatted end time, or null if there was nothing open to close.
const endWorkForUser = async (
  user: User
): Promise<{ endTime: string } | null> => {
  const result = await endWorkSegment(user.id);
  if (!result) return null;

  const seg = result.workSegments[result.workSegments.length - 1];
  const timeOpts: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  const projectName = seg?.project ?? "Unknown Project";
  const startTime = seg?.start ? new Date(seg.start).toLocaleTimeString([], timeOpts) : "—";
  const endTime = seg?.end ? new Date(seg.end).toLocaleTimeString([], timeOpts) : "—";
  const ms = seg?.length_ms ?? 0;
  const timeWorked = formatWorkedDuration(ms);

  if (ms >= DESCRIPTION_MIN_SEGMENT_MS && seg) {
    const summary = `Logged work segment:\n\n${projectName}\nStart: ${startTime}\nEnd: ${endTime}\nTime Worked: ${timeWorked}`;
    promptForSegmentDescription({
      user,
      attendanceId: result.id,
      segmentStartMs: seg.start.getTime(),
      projectName,
      summary,
    });
  }

  return { endTime };
};

const addAttendanceChange = async (attendanceChangePayload: {
  attendanceChangeCommand: EAttendanceCommands;
  user: User;
  attendanceChangeCallBack: NotifyCallback;
  projectName?: string;
}) => {
  const {
    attendanceChangeCommand,
    user,
    attendanceChangeCallBack: notifyDiscordUserCallback,
    projectName,
  } = attendanceChangePayload;

  const actionLogic = async () => {
    try {
      switch (attendanceChangeCommand) {
        case EAttendanceCommands.START_WORK: {
          if (!projectName) {
            notifyDiscordUserCallback(
              `Error starting work segment — you are not in a tracked project channel.`,
              user.discordInfo.id
            );
            break;
          }
          const started = await startWorkForUser(
            user,
            projectName,
            notifyDiscordUserCallback
          );
          if (started) {
            notifyDiscordUserCallback(
              `${process.env.STATUS_TAG_AVAILABLE} Started working on ${projectName}...`,
              user.discordInfo.id
            );
          }
          break;
        }
        case EAttendanceCommands.END_WORK: {
          const ended = await endWorkForUser(user);
          if (ended) {
            notifyDiscordUserCallback(
              `Ended work segment at ${ended.endTime}`,
              user.discordInfo.id
            );
          }
          break;
        }
        case EAttendanceCommands.SWITCH_WORK: {
          if (!projectName) {
            notifyDiscordUserCallback(
              `Error switching work segment — you are not in a tracked project channel.`,
              user.discordInfo.id
            );
            break;
          }
          // Close the current project's segment (DMs a summary), then open a
          // fresh one on the project the user just switched into.
          await endWorkForUser(user);
          const switched = await startWorkForUser(
            user,
            projectName,
            notifyDiscordUserCallback
          );
          if (switched) {
            notifyDiscordUserCallback(
              `${process.env.STATUS_TAG_AVAILABLE} Switched to ${projectName}...`,
              user.discordInfo.id
            );
          }
          break;
        }
        default:
          break;
      }
    } catch (error) {
      console.error("Error executing attendance action:", error);
      notifyDiscordUserCallback(
        `${process.env.STATUS_TAG_ERROR} An error occurred while updating your work segment.`,
        user.discordInfo.id
      );
    }
  };

  pendingTimeouts[user.id] = setTimeout(() => {
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete pendingTimeouts[user.id];

    if (!userActionQueues[user.id]) {
      userActionQueues[user.id] = [];
    }
    userActionQueues[user.id].push(actionLogic);
    processNextAction(user.id);
  }, ATTENDANCE_DELAY_IN_SECONDS * 1000);
};

export const handleVoiceStateChange = async (
  preTransitionState: VoiceState,
  postTransitionState: VoiceState,
  attendanceChangeCallBack: (msg: string, userDiscordId: string) => void
) => {
  const member = postTransitionState.member ?? preTransitionState.member;
  if (member?.user.bot) return;

  const isSameChannel =
    preTransitionState.channelId === postTransitionState.channelId;
  if (isSameChannel) return;

  // Only channels assigned to a project count toward attendance. Resolve the
  // project (if any) on both sides of the transition so we can decide whether
  // the user entered or left a tracked work channel.
  const [preProject, postProject] = await Promise.all([
    preTransitionState.channelId
      ? getProjectByChannelId(preTransitionState.channelId)
      : Promise.resolve(null),
    postTransitionState.channelId
      ? getProjectByChannelId(postTransitionState.channelId)
      : Promise.resolve(null),
  ]);

  // Neither side of the transition is a tracked channel — nothing to do.
  if (!preProject && !postProject) return;

  // Moving between two channels of the *same* project keeps the current
  // segment running; only a change of project is a start/stop/switch boundary.
  if (preProject && postProject && preProject.id === postProject.id) return;

  let user: User;
  try {
    user = await getUserByDiscordId(postTransitionState.id);
  } catch (error) {
    if (error instanceof Error && error.message === "User not found") {
      return;
    }
    throw error;
  }

  if (pendingTimeouts[user.id] !== undefined) {
    clearTimeout(pendingTimeouts[user.id]);
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete pendingTimeouts[user.id];
  }

  let attendanceCommand: EAttendanceCommands | null = null;
  let projectName: string | undefined = undefined;

  if (preProject && postProject) {
    // Switched from one project's channel to another's: end the old segment
    // and start a new one on the new project.
    projectName = postProject.name;
    attendanceCommand = EAttendanceCommands.SWITCH_WORK;
  } else if (preProject) {
    // Left a tracked channel for an untracked one (or disconnected).
    const isActive = await hasActiveWorkSegment(user.id);
    if (isActive) {
      attendanceCommand = EAttendanceCommands.END_WORK;
    }
  } else if (postProject) {
    // Entered a tracked channel from an untracked one.
    projectName = postProject.name;
    const canStart = !(await hasActiveWorkSegment(user.id));
    if (canStart) {
      attendanceCommand = EAttendanceCommands.START_WORK;
    }
  }

  if (attendanceCommand) {
    addAttendanceChange({
      attendanceChangeCommand: attendanceCommand,
      user,
      attendanceChangeCallBack,
      projectName,
    });
  }
};
