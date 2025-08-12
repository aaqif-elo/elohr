import {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from "discord.js";
import { EMeetingCommands, MEETING_PARTICIPANT_OPTION_NAMES } from "../discord.enums";

// /meeting command: accepts users (mentionable), role (role), agenda (string, required), duration (integer minutes), optional heatmap flag
const meetingCommand = new SlashCommandBuilder()
  .setName(EMeetingCommands.MEETING)
  .setDescription("Find a time and create a meeting with selected users or a role");

// Add required options first (Discord requires required options before optional ones)
// 1) First participant mentionable (required)
meetingCommand.addMentionableOption((opt) =>
  opt
    .setName(MEETING_PARTICIPANT_OPTION_NAMES[0])
    .setDescription("Mention a user or a role to include")
    .setRequired(true)
);
// 2) Agenda (required)
meetingCommand.addStringOption((opt) =>
  opt
    .setName("agenda")
    .setDescription("Required meeting agenda/title")
    .setRequired(true)
);

// Add optional options afterwards
// Remaining participant mentionables (optional)
MEETING_PARTICIPANT_OPTION_NAMES.slice(1).forEach((name) => {
  meetingCommand.addMentionableOption((opt) =>
    opt
      .setName(name)
      .setDescription("Optional additional user or role")
      .setRequired(false)
  );
});

meetingCommand
  .addStringOption((opt) =>
    opt
      .setName("date")
      .setDescription("Schedule date (YYYY-MM-DD). Defaults to today.")
      .setRequired(false)
  )
  .addIntegerOption((opt) =>
    opt
      .setName("duration")
      .setDescription("Meeting duration in minutes (default 30)")
      .setRequired(false)
      .setMinValue(10)
      .setMaxValue(120)
  )
  .addBooleanOption((opt) =>
    opt
      .setName("heatmap")
      .setDescription("Include an ASCII heatmap visualization of availability (default off)")
      .setRequired(false)
  );

export const meetingCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  meetingCommand.toJSON();
