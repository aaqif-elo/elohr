import { EAdminCommands } from "../discord.enums";
import {
  getHRLoginInteractionReplyPayload,
  getUpcomingHolidayAnnouncementMsg,
  announceHoliday,
} from "../services";
import {
  ChatInputCommandInteraction,
  CacheType,
  TextChannel,
} from "discord.js";

const attendanceChannelID =
  process.env.NODE_ENV === "production"
    ? process.env.ATTENDANCE_CHANNEL_ID
    : process.env.TEST_CHANNEL_ID;

if (!attendanceChannelID)
  throw new Error("ATTENDANCE_CHANNEL_ID is not defined");

export const handleAdminCommand = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  switch (interaction.commandName) {
    case EAdminCommands.GET_HOLIDAY_ANNOUNCEMENT: {
      const nextHolidayAnnouncementObj =
        await getUpcomingHolidayAnnouncementMsg();
      interaction.reply({
        content: nextHolidayAnnouncementObj,
        flags: "Ephemeral",
      });
      break;
    }
    case EAdminCommands.OVERRIDE_HOLIDAY_ANNOUNCEMENT: {
      await getHRLoginInteractionReplyPayload(
        interaction,
        "override holiday announcement"
      );

      break;
    }
    case EAdminCommands.ANNOUNCE_NEXT_HOLIDAY: {
      // Defer reply as this might take some time
      await interaction.deferReply();

      const response = await announceHoliday(interaction.client);

      if (!response) {
        interaction.editReply({
          content:
            "✅ Holiday announcement sent successfully and marked as announced.",
        });
      } else {
        interaction.editReply({
          content: response,
        });
      }

      break;
    }
  }
};
