import {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from "discord.js";
import { EAttendanceCommands, ESlashCommandOptionNames } from "./discord.enums";
import { canBreak, breakStart } from "~/server/db";

const breakCommand = new SlashCommandBuilder()
  .setName(EAttendanceCommands.BREAK)
  .setDescription(
    `${process.env.STATUS_TAG_BREAK} Have a Break, Have a Kit Kat 🍫`
  )
  .addStringOption((option) =>
    option
      .setName(ESlashCommandOptionNames.BREAK_REASON)
      .setDescription("Reason for taking a break (Default option is Kit Kat)")
      .setRequired(false)
  );

export const breakCommandHandler = async (
  userId: string,
  reason?: string
): Promise<string> => {
  const canTakeBreak = await canBreak(userId);
  if (canTakeBreak === true) {
    const breakInfo = await breakStart(userId, reason);
    if (breakInfo) {
      return `✅ ${
        reason === "" ? "Break" : reason + " break"
      } started at ${breakInfo}...`;
    } else {
      return ``;
    }
  } else {
    if (typeof canTakeBreak === "string") {
      return `❌ You are already on a break which started at ${canTakeBreak}...`;
    } else {
      return ``;
    }
  }
};

export const breakCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  breakCommand.toJSON();
