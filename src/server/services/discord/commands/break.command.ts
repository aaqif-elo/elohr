import {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from "discord.js";
import {
  EAttendanceCommands,
  ESlashCommandOptionNames,
} from "../discord.enums";
import { canBreak, breakStart } from "../../../db";

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
  console.log("Break command handler called");
  const canTakeBreak = await canBreak(userId);
  console.log("Can take break: ", canTakeBreak);
  if (canTakeBreak === true) {
    const breakInfo = await breakStart(userId, reason);
    console.log("Break info: ", breakInfo);
    if (breakInfo) {
      return `✅ ${
        reason === "" ? "Break" : reason + " break"
      } started at ${breakInfo}...`;
    } else {
      return ``;
    }
  } else {
    return `❌ You are already on a break which started at ${canTakeBreak.toLocaleTimeString()}...`;
  }
};

export const breakCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  breakCommand.toJSON();
