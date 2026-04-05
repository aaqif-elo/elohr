import type {RESTPostAPIChatInputApplicationCommandsJSONBody} from 'discord.js';
import { SlashCommandBuilder} from 'discord.js';
import {EAuthCommands} from '../discord.enums';

const authCommand = new SlashCommandBuilder()
  .setName(EAuthCommands.HR)
  .setDescription(`🌐 Login to Web Portal`);

export const authCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  authCommand.toJSON();
