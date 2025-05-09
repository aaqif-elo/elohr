import {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from "discord.js";
import { EAttendanceCommands } from "../discord.enums";
import {
  getLoginTime,
  ONE_DAY_IN_MS,
  getLogoutTime,
  logout,
  hasActiveLoginSessionFromYesterday,
} from "../../../db";

const logoutCommand = new SlashCommandBuilder()
  .setName(EAttendanceCommands.LOGOUT)
  .setDescription(
    `${process.env.STATUS_TAG_UNAVAILABLE} See you the next day 👋`
  );

export const logoutCommandHandler = async (
  userId: string,
  timestamp: number,
  reportSendCallBack: (report: Buffer<ArrayBuffer>) => void
): Promise<string> => {
  try {
    const loginTime = await getLoginTime(userId);

    if (loginTime === null) {
      const yesterdaysSession = await hasActiveLoginSessionFromYesterday(
        userId
      );
      if (!yesterdaysSession) {
        return `❌ You have not logged in for the day.`;
      } else {
        timestamp -= ONE_DAY_IN_MS;
      }
    }

    const logoutTime = await getLogoutTime(userId);
    if (logoutTime !== null) {
      return `❌ Logout Error! You have already logged out at ${logoutTime}.`;
    }

    const logoutInfo = await logout(userId);
    if (logoutInfo) {
      if (logoutInfo.report) {
        reportSendCallBack(logoutInfo.report);
      }
      return `✅ Successfully logged out at ${logoutInfo.time}!`;
    } else {
      return ``;
    }
  } catch (err) {
    console.error(err);
    return `❌ Error executing command! ${JSON.stringify(err)}}`;
  }
};

export const logoutCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  logoutCommand.toJSON();
