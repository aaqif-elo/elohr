import { EAttendanceCommands } from "./discord.enums";
import { VoiceState } from "discord.js";
import { getGuildMember } from ".";
import {
  breakEnd,
  breakStart,
  canBreak,
  canBreakOrResume,
  getLoginTime,
  getUserByDiscordId,
  isOnBreak,
  login,
  switchProject,
  updateUserAvatar,
} from "../../db";
import { User } from "@prisma/client";

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
      // Consider more specific error handling or user notification if needed
    } finally {
      userActionInProgress[userId] = false;
      // Attempt to process the next action in the queue for this user
      processNextAction(userId);
    }
  } else {
    // Queue was empty, ensure flag is reset
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
            // Asynchronously update avatar, non-blocking for login message
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
              `${
                process.env.STATUS_TAG_AVAILABLE
              } Successfully logged in at ${loginResponse.login.toLocaleTimeString()}...`,
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
      case EAttendanceCommands.BREAK: {
        try {
          const breakStartResponse = await breakStart(user.id);
          notifyDiscordUserCallback(
            `${
              process.env.STATUS_TAG_BREAK
            } break started at ${breakStartResponse?.toLocaleTimeString()}...`,
            user.discordInfo.id
          );
        } catch (error) {
          console.error("Error during break start action:", error);
          notifyDiscordUserCallback(
            `${process.env.STATUS_TAG_ERROR} An error occurred starting break.`,
            user.discordInfo.id
          );
        }
        break;
      }
      case EAttendanceCommands.RESUME: {
        if (!currentVoiceChannelName) {
          notifyDiscordUserCallback(
            `Error ending break, you are not in a voice channel.`,
            user.discordInfo.id
          );
        } else {
          try {
            const breakEndResponse = await breakEnd(user.id, currentVoiceChannelName);
            let response = `${process.env.STATUS_TAG_ERROR} Error ending break!`;
            if (breakEndResponse) {
              response = `${process.env.STATUS_TAG_AVAILABLE} ${breakEndResponse}...`;
            }
            notifyDiscordUserCallback(response, user.discordInfo.id);
          } catch (error) {
            console.error("Error during break end action:", error);
            notifyDiscordUserCallback(
              `${process.env.STATUS_TAG_ERROR} An error occurred ending break.`,
              user.discordInfo.id
            );
          }
        }
        break;
      }
      case EAttendanceCommands.SWITCH: {
        if (!currentVoiceChannelName) {
          notifyDiscordUserCallback(
            `Error switching voice channels, you are not in a voice channel.`,
            user.discordInfo.id
          );
        } else {
          try {
            const userIsOnBreak = await isOnBreak(user.id);
            if (userIsOnBreak) {
              const breakEndResponse = await breakEnd(user.id, currentVoiceChannelName);
              notifyDiscordUserCallback(
                `${process.env.STATUS_TAG_AVAILABLE} ${
                  breakEndResponse as string // Ensure breakEndResponse is handled as string
                }`,
                user.discordInfo.id
              );
            } else {
              await switchProject(user.id, currentVoiceChannelName);
              notifyDiscordUserCallback(
                `${process.env.STATUS_TAG_SWITCH} active project switched to ${currentVoiceChannelName}`,
                user.discordInfo.id
              );
            }
          } catch (err: any) {
            console.error("Error during switch action:", err);
            notifyDiscordUserCallback(
              `${process.env.STATUS_TAG_ERROR} Error during switch: ${err.message}`,
              user.discordInfo.id
            );
          }
        }
        break;
      }
      default:
        break;
    }
  };

  pendingTimeouts[user.id] = setTimeout(() => {
    delete pendingTimeouts[user.id]; // This specific timeout has fired

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
  const isSameChannel =
    preTransitionState.channelId === postTransitionState.channelId;
  if (isSameChannel) return;

  if (
    !preTransitionState.guild.afkChannel ||
    !postTransitionState.guild.afkChannel
  )
    return;

  const user = await getUserByDiscordId(postTransitionState.id);
  if (!user) return;

  // Clear any existing timeout for this user first
  if (pendingTimeouts[user.id] !== undefined) {
    clearTimeout(pendingTimeouts[user.id]);
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
    const canWork =
      (await canBreak(user.id)) === true &&
      (await canBreakOrResume(user.id)) === true;
    if (canWork) {
      attendanceCommand = EAttendanceCommands.BREAK;
    }
  } else if (comingOnline) {
    voiceChannelName = postTransitionState.channel?.name;
    const canResume = await isOnBreak(user.id);
    if (canResume) {
      attendanceCommand = EAttendanceCommands.RESUME;
    } else {
      const canLogin = (await getLoginTime(user.id)) === null;
      if (canLogin) {
        attendanceCommand = EAttendanceCommands.LOGIN;
      }
    }
  } else if (postTransitionState.channel?.name) {
    // This condition implies switching between non-AFK channels,
    // as it's not goingOffline and not comingOnline, but is in a new channel.
    // Ignore switching if either the source or destination channel is HR or Admin.
    const HR_CHANNEL_ID = process.env.HR_CHANNEL_ID;
    const ADMIN_CHANNEL_ID = process.env.ADMIN_CHANNEL_ID;
    const fromChannelId = preTransitionState.channelId;
    const toChannelId = postTransitionState.channelId;
    const isIgnoredSwitch =
      fromChannelId === HR_CHANNEL_ID ||
      fromChannelId === ADMIN_CHANNEL_ID ||
      toChannelId === HR_CHANNEL_ID ||
      toChannelId === ADMIN_CHANNEL_ID;

    if (!isIgnoredSwitch) {
      attendanceCommand = EAttendanceCommands.SWITCH;
      voiceChannelName = postTransitionState.channel?.name;
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
