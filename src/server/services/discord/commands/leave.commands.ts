import {RESTPostAPIChatInputApplicationCommandsJSONBody, SlashCommandBuilder} from 'discord.js';
import {ELeaveCommands} from './discord.enums';

const requestLeaveCommand = new SlashCommandBuilder()
  .setName(ELeaveCommands.REQUEST_LEAVE)
  .setDescription(`🏖️ Request a leave`)
  .addStringOption(option =>
    option
      .setName('start')
      .setDescription('Start date of leave (Inclusive) (YYYY-MM-DD)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option
      .setName('end')
      .setDescription('End date of leave (Inclusive) (YYYY-MM-DD)')
      .setRequired(true)
  )
  .addStringOption(option =>
    option.setName('reason').setDescription('Reason for leave (Optional)').setRequired(false)
  );

const reviewLeaveCommand = new SlashCommandBuilder()
  .setName(ELeaveCommands.REVIEW_LEAVE_REQUEST)
  .setDescription(`🧑🏽‍⚖️ Approve/Reject a leave request`)
  .addStringOption(option =>
    option.setName('id').setDescription('ID of leave request').setRequired(true)
  )
  .addBooleanOption(option =>
    option.setName('approved').setDescription('Approve or reject leave request').setRequired(true)
  );

export const requestLeaveCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  requestLeaveCommand.toJSON();
export const reviewLeaveCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  reviewLeaveCommand.toJSON();
