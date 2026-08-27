import type {
  RESTPostAPIChatInputApplicationCommandsJSONBody} from "discord.js";
import {
  SlashCommandBuilder,
} from "discord.js";
import { EReportCommands } from "../discord.enums";

// /report command: personal summary by default; admins may pass `employee` for a
// task-wise CSV of one employee, and `month` to target a past calendar month.
const reportCommand = new SlashCommandBuilder()
  .setName(EReportCommands.REPORT)
  .setDescription("Your personal report of hours worked this month")
  .addUserOption((opt) =>
    opt
      .setName("employee")
      .setDescription(
        "Admin only: download a task-wise CSV for this employee",
      )
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName("month")
      .setDescription("Which month to report on (defaults to the current month)")
      .setRequired(false)
      .setAutocomplete(true),
  );

export const reportCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  reportCommand.toJSON();
