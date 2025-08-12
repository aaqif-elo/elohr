import { CacheType, ChatInputCommandInteraction, Client } from "discord.js";
import { handleAdminCommand } from "./admin.handler";
import { EAuthCommands, ELeaveCommands, EMeetingCommands } from "../discord.enums";
import { handleLeaveCommand } from "./leave.handler";
import { handleAuthCommand } from "./auth.handler";
import { handleMeetingCommand } from "./meeting.handler";

console.log("NODE_ENV", process.env.NODE_ENV);
const production = process.env.NODE_ENV === "production";
const attendanceChannelID = production
  ? process.env.ATTENDANCE_CHANNEL_ID
  : process.env.TEST_CHANNEL_ID;

const modID = process.env.MOD_ID;

const sendErrorInteractionResponse = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  // Check if already replied
  if (interaction.replied) {
    return;
  }
  interaction.reply({
    content: `❌ Error handling command \`/${interaction.commandName}\`! Notifying: <@${modID}>`,
  });
};

export const interactionHandler = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  try {
    // Route meeting command regardless of channel (guild validation happens in handler)
    if (interaction.commandName === EMeetingCommands.MEETING) {
      await handleMeetingCommand(interaction);
      return;
    }

    if (interaction.channelId === attendanceChannelID) {
      if (ELeaveCommands.REQUEST_LEAVE === interaction.commandName) {
        handleLeaveCommand(interaction);
      } else if (EAuthCommands.HR === interaction.commandName) {
        handleAuthCommand(interaction);
      }
    } else if (interaction.channelId === process.env.ADMIN_CHANNEL_ID) {
      handleAdminCommand(interaction);
    } else {
      if (production) {
        interaction.reply({
          content: `<@${interaction.user.id}> ❌ Please use the <#${attendanceChannelID}> channel for attendance related commands`,
        });
      }
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
    sendErrorInteractionResponse(interaction);
  }
};
