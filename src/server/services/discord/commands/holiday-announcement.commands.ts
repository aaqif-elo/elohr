import {
  RESTPostAPIChatInputApplicationCommandsJSONBody,
  SlashCommandBuilder,
} from "discord.js";
import { EAdminCommands } from "../discord.enums";

const getNextHolidayAnnouncementCommand = new SlashCommandBuilder()
  .setName(EAdminCommands.GET_HOLIDAY_ANNOUNCEMENT)
  .setDescription(`See and modify the next holiday announcement`);

export const getNextHolidayAnnouncementCommandBody: RESTPostAPIChatInputApplicationCommandsJSONBody =
  getNextHolidayAnnouncementCommand.toJSON();
