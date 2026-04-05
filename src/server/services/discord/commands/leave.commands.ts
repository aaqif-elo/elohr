import type {
  RESTPostAPIChatInputApplicationCommandsJSONBody} from "discord.js";
import {
  SlashCommandBuilder,
} from "discord.js";
import { ELeaveCommands } from "../discord.enums";

const requestLeaveCommand = new SlashCommandBuilder()
  .setName(ELeaveCommands.REQUEST_LEAVE)
  .setDescription(`🏖️ Request a leave`);

export const requestLeaveCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  requestLeaveCommand.toJSON();
