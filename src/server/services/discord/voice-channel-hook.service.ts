import { EAttendanceCommands } from "./discord.enums";
import type { VoiceState } from "discord.js";
import { getGuildMember } from ".";
import {
  getLoginTime,
  getUserByDiscordId,
  login,
  logout,
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
      case EAttendanceCommands.LOGIN: {
        if (!currentVoiceChannelName) {
          notifyDiscordUserCallback(
            `Error logging in, you are not in a voice channel.`,
            user.discordInfo.id
          );
        } else {
          try {
            const loginResponse = await login(user.id, currentVoiceChannelName);
            if (typeof loginResponse === "string") {
              notifyDiscordUserCallback(
                `${process.env.STATUS_TAG_ERROR} ${loginResponse}`,
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
                  updateUserAvatar(user.id, member.user.avatar).catch(err => console.error("Error updating avatar:", err));
                }
              })
              .catch(err => console.error("Error getting guild member for avatar update:", err));

            notifyDiscordUserCallback(
              `${process.env.STATUS_TAG_AVAILABLE} Successfully logged in at ${loginResponse.login.toLocaleTimeString()}...`,
              user.discordInfo.id
            );
          } catch (error) {
            console.error("Error during login action:", error);
            notifyDiscordUserCallback(
              `${process.env.STATUS_TAG_ERROR} An error occurred during login.`,
              user.discordInfo.id
            );
          }
        }
        break;
      }
      case EAttendanceCommands.LOGOUT: {
        try {
          const logoutResponse = await logout(user.id);
          if (!logoutResponse) {
            return;
          }
          notifyDiscordUserCallback(
            `Logged out at ${logoutResponse.time.toLocaleTimeString()}...`,
            user.discordInfo.id
          );
        } catch (error) {
          console.error("Error during logout action:", error);
          notifyDiscordUserCallback(
            `${process.env.STATUS_TAG_ERROR} An error occurred during logout.`,
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
    const isLoggedIn = (await getLoginTime(user.id)) !== null;
    if (isLoggedIn) {
      attendanceCommand = EAttendanceCommands.LOGOUT;
    }
  } else if (comingOnline) {
    voiceChannelName = postTransitionState.channel?.name;
    const canLogin = (await getLoginTime(user.id)) === null;
    if (canLogin) {
      attendanceCommand = EAttendanceCommands.LOGIN;
    }
  }
  // Switching between non-AFK channels triggers no action

  if (attendanceCommand) {
    addAttendanceChange({
      attendanceChangeCommand: attendanceCommand,
      user,
      attendanceChangeCallBack,
      currentVoiceChannelName: voiceChannelName,
    });
  }
};
