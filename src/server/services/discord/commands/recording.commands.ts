import type {
    RESTPostAPIChatInputApplicationCommandsJSONBody} from "discord.js";
import {
    SlashCommandBuilder,
} from "discord.js";
import { ERecordingCommands } from "../discord.enums";

// /record command toggles start/stop for the caller's server
const recordCommand = new SlashCommandBuilder()
    .setName(ERecordingCommands.RECORD)
    .setDescription("Start or stop recording the active voice session");

export const recordingCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
    recordCommand.toJSON();
