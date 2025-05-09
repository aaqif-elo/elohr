import { ONE_MINUTE_IN_MS } from "../../../db";
import { EAdminCommands } from "../discord.enums";
import {
  getUpcomingHolidayAnnouncementMsg,
  announceHoliday,
  getLoginUrl,
} from "../services";
import {
  ChatInputCommandInteraction,
  CacheType,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
} from "discord.js";

const attendanceChannelID =
  process.env.NODE_ENV === "production"
    ? process.env.ATTENDANCE_CHANNEL_ID
    : process.env.TEST_CHANNEL_ID;

if (!attendanceChannelID)
  throw new Error("ATTENDANCE_CHANNEL_ID is not defined");

enum GET_HOLIDAY_BUTTON_IDS {
  ANNOUNCE_NOW = "announce-now",
}

export const handleAdminCommand = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  switch (interaction.commandName) {
    case EAdminCommands.GET_HOLIDAY_ANNOUNCEMENT: {
      const [nextHolidayAnnouncementObj, loginUrl] = await Promise.all([
        getUpcomingHolidayAnnouncementMsg(),
        getLoginUrl(interaction.user.id),
      ]);

      if (!loginUrl) {
        interaction.reply({
          content: "❌ Failed to generate login URL.",
          flags: "Ephemeral",
        });
        return;
      }

      const loginButton = new ButtonBuilder()
        .setLabel("Modify Holiday (HR Admin Login)")
        .setStyle(ButtonStyle.Link)
        .setURL(loginUrl)
        .setEmoji("🌐");

      const announceNowButton = new ButtonBuilder()
        .setLabel("Announce Now")
        .setStyle(ButtonStyle.Primary)
        .setCustomId(GET_HOLIDAY_BUTTON_IDS.ANNOUNCE_NOW)
        .setEmoji("📢");

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        announceNowButton,
        loginButton
      );

      const content = `${nextHolidayAnnouncementObj} \n\n**Note:** You can use the buttons below to interact with the holiday announcement within the next minute.`;

      const response = await interaction.reply({
        content,
        components: [row],
        flags: "Ephemeral",
        withResponse: true,
      });

      try {
        const confirmation =
          await response.resource?.message?.awaitMessageComponent({
            filter: (i) => i.user.id === interaction.user.id,
            time: ONE_MINUTE_IN_MS,
          });

        if (!confirmation) {
          await interaction.editReply({
            content: "Confirmation not received within 1 minute, cancelling",
            components: [],
          });
          return;
        }

        switch (confirmation.customId as GET_HOLIDAY_BUTTON_IDS) {
          case GET_HOLIDAY_BUTTON_IDS.ANNOUNCE_NOW: {
            await confirmation.update({
              content: "Announcing holiday now...",
              components: [],
            });
            const response = await announceHoliday(interaction.client);
            if (!response) {
              await confirmation.editReply({
                content: "✅ Holiday announcement sent successfully.",
                components: [],
              });
            } else {
              await confirmation.editReply({
                content: response,
                components: [],
              });
            }
            break;
          }

          default: {
            await confirmation.update({
              content: "Invalid action.",
              components: [],
            });
            break;
          }
        }
      } catch (error) {
        console.error("Error handling button interaction:", error);
        await interaction.editReply({
          content: "An error occurred while processing your request.",
          components: [],
        });
      }
    }
    default: {
      interaction.reply({
        content: `<@${interaction.user.id}> ❌ Invalid command!`,
        flags: "Ephemeral",
      });
      break;
    }
  }
};
