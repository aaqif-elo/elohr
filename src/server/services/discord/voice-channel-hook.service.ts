import { EAttendanceCommands } from "./discord.enums";
import type { VoiceState } from "discord.js";
import { getGuildMember } from ".";
import {
  hasActiveWorkSegment,
  startWorkSegment,
  endWorkSegment,
  getUserByDiscordId,
  updateUserAvatar,
} from "../../db";
import type { User } from "@prisma/client";

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

const addAttendanceChange = async (attendanceChangePayload: {
  attendanceChangeCommand: EAttendanceCommands;
  user: User;
  attendanceChangeCallBack: (msg: string, userDiscordId: string) => void;
  currentVoiceChannelName?: string;
}) => {
  const {
    attendanceChangeCommand,
    user,
    attendanceChangeCallBack: notifyDiscordUserCallback,
    currentVoiceChannelName,
  } = attendanceChangePayload;

  const actionLogic = async () => {
    switch (attendanceChangeCommand) {
      case EAttendanceCommands.START_WORK: {
        if (!currentVoiceChannelName) {
          notifyDiscordUserCallback(
            `Error starting work segment — you are not in a voice channel.`,
            user.discordInfo.id
          );
        } else {
          try {
            const result = await startWorkSegment(user.id, currentVoiceChannelName);
            if (typeof result === "string") {
              notifyDiscordUserCallback(
                `${process.env.STATUS_TAG_ERROR} ${result}`,
                user.discordInfo.id
              );
              return;
            }
            getGuildMember(user.discordInfo.id)
              .then((member) => {
                if (
                  member?.user.avatar &&
                  member.user.avatar !== user.discordInfo.avatar
                ) {
                  updateUserAvatar(user.id, member.user.avatar).catch(err =>
                    console.error("Error updating avatar:", err)
                  );
                }
              })
              .catch(err => console.error("Error getting guild member for avatar update:", err));

            notifyDiscordUserCallback(
              `${process.env.STATUS_TAG_AVAILABLE} Started working on ${currentVoiceChannelName}...`,
              user.discordInfo.id
            );
          } catch (error) {
            console.error("Error during start work action:", error);
            notifyDiscordUserCallback(
              `${process.env.STATUS_TAG_ERROR} An error occurred while starting a work segment.`,
              user.discordInfo.id
            );
          }
        }
        break;
      }
      case EAttendanceCommands.END_WORK: {
        try {
          const result = await endWorkSegment(user.id);
          if (!result) {
            return;
          }
          notifyDiscordUserCallback(
            `Ended work segment at ${new Date().toLocaleTimeString()}...`,
            user.discordInfo.id
          );
        } catch (error) {
          console.error("Error during end work action:", error);
          notifyDiscordUserCallback(
            `${process.env.STATUS_TAG_ERROR} An error occurred while ending the work segment.`,
            user.discordInfo.id
          );
        }
        break;
      }
      default:
        break;
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

  if (
    !preTransitionState.guild.afkChannel ||
    !postTransitionState.guild.afkChannel
  )
    return;

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

  const isAFK =
    postTransitionState.guild.afkChannel.id === postTransitionState.channelId;
  const isNotInVoiceChannel = postTransitionState.channelId === null;
  const wasInNonAFKVoiceChannel =
    preTransitionState.channelId !== null &&
    preTransitionState.guild.afkChannel.id !== preTransitionState.channelId;

  const goingOffline =
    wasInNonAFKVoiceChannel && (isAFK || isNotInVoiceChannel);
  const comingOnline =
    !wasInNonAFKVoiceChannel && !isAFK && !isNotInVoiceChannel;

  let attendanceCommand: EAttendanceCommands | null = null;
  let voiceChannelName: string | undefined = undefined;

  if (goingOffline) {
    const isActive = await hasActiveWorkSegment(user.id);
    if (isActive) {
      attendanceCommand = EAttendanceCommands.END_WORK;
    }
  } else if (comingOnline) {
    voiceChannelName = postTransitionState.channel?.name;
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
      currentVoiceChannelName: voiceChannelName,
    });
  }
};
