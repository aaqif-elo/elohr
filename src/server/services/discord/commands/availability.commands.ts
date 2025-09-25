import {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from "discord.js";
import { EAvailabilityCommands } from "../discord.enums";

// /availability command: /availability user:@member [days]
const availabilityCommand = new SlashCommandBuilder()
  .setName(EAvailabilityCommands.AVAILABILITY)
  .setDescription("Show most likely active times for a member (last N days)")
  .addUserOption((opt) =>
    opt
      .setName("user")
      .setDescription("Guild member to analyze")
      .setRequired(true)
  )
  .addIntegerOption((opt) =>
    opt
      .setName("days")
      .setDescription("Lookback window in days (default 30)")
      .setMinValue(7)
      .setMaxValue(120)
      .setRequired(false)
  );

export const availabilityCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  availabilityCommand.toJSON();
