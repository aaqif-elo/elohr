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

const attendanceChangesToDo: Record<string, NodeJS.Timeout> = {};

const addAttendanceChange = async (attendanceChangePayload: {
  attendanceChangeCommand: EAttendanceCommands;
  user: User;
  attendanceChangeCallBack: (msg: string, userDiscordId: string) => void;
  currentVoiceChannelName?: string;
}) => {
  const {
    attendanceChangeCommand,
    user,
    attendanceChangeCallBack: addAttendanceChangeCallBack,
    currentVoiceChannelName,
  } = attendanceChangePayload;
  const attendanceChangeCallBack = (
    attendanceChangeCommand: EAttendanceCommands,
    callBack: (msg: string, userDiscordId: string) => void
  ) => {
    switch (attendanceChangeCommand) {
      case EAttendanceCommands.LOGIN: {
        if (!currentVoiceChannelName) {
          callBack(
            `Error logging in, you are not in a voice channel.`,
            user.discordInfo.id
          );
        } else {
          login(user.id, currentVoiceChannelName).then((loginResponse) => {
            getGuildMember(user.discordInfo.id).then((member) => {
              if (
                member.user.avatar &&
                member.user.avatar !== user.discordInfo.avatar
              ) {
                updateUserAvatar(user.id, member.user.avatar);
              }
            });
            callBack(
              `${process.env.STATUS_TAG_AVAILABLE} Successfully logged in at ${
                loginResponse as string
              }...`,
              user.discordInfo.id
            );
          });
        }
        break;
      }
      case EAttendanceCommands.BREAK: {
        breakStart(user.id).then((breakStartResponse) => {
          callBack(
            `${
              process.env.STATUS_TAG_BREAK
            } break started at ${breakStartResponse?.toLocaleTimeString()}...`,
            user.discordInfo.id
          );
        });
        break;
      }
      case EAttendanceCommands.RESUME: {
        if (!currentVoiceChannelName) {
          callBack(
            `Error ending break, you are not in a voice channel.`,
            user.discordInfo.id
          );
        } else {
          breakEnd(user.id, currentVoiceChannelName).then(
            (breakEndResponse) => {
              let response = `Error ending break!`;
              if (breakEndResponse) {
                response = `${process.env.STATUS_TAG_AVAILABLE} break ended at ${breakEndResponse}...`;
              }
              callBack(response, user.discordInfo.id);
            }
          );
        }
        break;
      }

      case EAttendanceCommands.SWITCH: {
        if (!currentVoiceChannelName) {
          callBack(
            `Error switching voice channels, you are not in a voice channel.`,
            user.discordInfo.id
          );
        } else {
          isOnBreak(user.id).then((canResume) => {
            if (canResume) {
              breakEnd(user.id, currentVoiceChannelName)
                .then((breakEndResponse) => {
                  callBack(
                    `${process.env.STATUS_TAG_AVAILABLE} ${
                      breakEndResponse as string
                    }`,
                    user.discordInfo.id
                  );
                })
                .catch((err) => {
                  console.error("Error ending break:", err);
                  callBack(
                    `Error ending break: ${err.message}`,
                    user.discordInfo.id
                  );
                });
            } else {
              switchProject(user.id, currentVoiceChannelName)
                .then((_) => {
                  callBack(
                    `${process.env.STATUS_TAG_SWITCH} active project switched to ${currentVoiceChannelName}`,
                    user.discordInfo.id
                  );
                })
                .catch((err) => {
                  console.error("Error switching project:", err);
                  callBack(
                    `Error switching project: ${err.message}`,
                    user.discordInfo.id
                  );
                });
            }
          });
        }
      }
      default:
        break;
    }
  };

  attendanceChangesToDo[user.id] = setTimeout(() => {
    delete attendanceChangesToDo[user.id];
    attendanceChangeCallBack(
      attendanceChangeCommand,
      addAttendanceChangeCallBack
    );
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
  if (goingOffline || comingOnline) {
    const user = await getUserByDiscordId(postTransitionState.id);
    if (!user) return;
    // Clear any pending attendance change calls
    if (attendanceChangesToDo[user.id] !== undefined) {
      clearTimeout(attendanceChangesToDo[user.id]);
    }

    // Joining a channel from offline/afk
    if (comingOnline) {
      console.log("joining a channel from AFK or disconnected state");
      const canResume = await isOnBreak(user.id);
      if (canResume) {
        return addAttendanceChange({
          attendanceChangeCommand: EAttendanceCommands.RESUME,
          user,
          attendanceChangeCallBack,
          currentVoiceChannelName: postTransitionState.channel?.name,
        });
      }

      const canLogin = (await getLoginTime(user.id)) === null;
      if (canLogin) {
        return addAttendanceChange({
          attendanceChangeCommand: EAttendanceCommands.LOGIN,
          user,
          attendanceChangeCallBack,
          currentVoiceChannelName: postTransitionState.channel?.name,
        });
      }
    }

    // Moving from an active voice channel to AFK or disconnecting from a voice channel
    else {
      const canWork =
        (await canBreak(user.id)) === true &&
        (await canBreakOrResume(user.id)) === true;
      if (canWork) {
        return addAttendanceChange({
          attendanceChangeCommand: EAttendanceCommands.BREAK,
          user,
          attendanceChangeCallBack,
        });
      }
    }
  } else if (postTransitionState.channel?.name) {
    const user = await getUserByDiscordId(postTransitionState.id);
    if (!user) return;
    // Clear any pending attendance change calls
    if (attendanceChangesToDo[user.id] !== undefined) {
      clearTimeout(attendanceChangesToDo[user.id]);
    }
    return addAttendanceChange({
      attendanceChangeCommand: EAttendanceCommands.SWITCH,
      user,
      attendanceChangeCallBack,
      currentVoiceChannelName: postTransitionState.channel?.name,
    });
  }
};
