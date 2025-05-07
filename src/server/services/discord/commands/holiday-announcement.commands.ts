import {RESTPostAPIChatInputApplicationCommandsJSONBody, SlashCommandBuilder} from 'discord.js';
import {EAdminCommands} from './discord.enums';

const getNextHolidayAnnouncementCommand = new SlashCommandBuilder()
  .setName(EAdminCommands.GET_HOLIDAY_ANNOUNCEMENT)
  .setDescription(`Get next holiday announcement`);

const setNextHolidayAnnouncementCommand = new SlashCommandBuilder()
  .setName(EAdminCommands.OVERRIDE_HOLIDAY_ANNOUNCEMENT)
  .setDescription(`Set next holiday announcement (Admin Only)`);

export const getNextHolidayAnnouncementCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  getNextHolidayAnnouncementCommand.toJSON();
export const setNextHolidayAnnouncementCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  setNextHolidayAnnouncementCommand.toJSON();
