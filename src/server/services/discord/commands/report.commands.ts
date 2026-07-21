import type {
  RESTPostAPIChatInputApplicationCommandsJSONBody} from "discord.js";
import {
  SlashCommandBuilder,
} from "discord.js";
import { EReportCommands } from "../discord.enums";

// /report command: /report
const reportCommand = new SlashCommandBuilder()
  .setName(EReportCommands.REPORT)
  .setDescription("Your personal report of hours worked this month");

export const reportCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  reportCommand.toJSON();
