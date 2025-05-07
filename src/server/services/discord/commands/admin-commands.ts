import {SlashCommandBuilder} from 'discord.js';
import {EAdminCommands} from './discord.enums';

export const announceNextHolidayCommandBody = new SlashCommandBuilder()
  .setName(EAdminCommands.ANNOUNCE_NEXT_HOLIDAY)
  .setDescription('Manually announce the next upcoming holiday')
  .toJSON();
