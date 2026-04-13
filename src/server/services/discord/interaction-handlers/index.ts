import type { CacheType, ChatInputCommandInteraction } from "discord.js";
import { handleAdminCommand } from "./admin.handler";
import { EAuthCommands, ELeaveCommands, EAvailabilityCommands, ERecordingCommands } from "../discord.enums";
import { handleLeaveCommand } from "./leave.handler";
import { handleAuthCommand } from "./auth.handler";
import { handleAvailabilityCommand } from "./availability.handler";
import { handleRecordingCommand } from "./recording.handler";
import {
  logInteractionAckTiming,
  sendInteractionErrorResponse,
} from "./interaction-response.utils";

console.log("NODE_ENV", process.env.NODE_ENV);
const production = process.env.NODE_ENV === "production";
const attendanceChannelID = production
  ? process.env.ATTENDANCE_CHANNEL_ID
  : process.env.TEST_CHANNEL_ID;

const modID = process.env.MOD_ID;

const sendErrorInteractionResponse = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  await sendInteractionErrorResponse(
    interaction,
    `❌ Error handling command \`/${interaction.commandName}\`! Notifying: <@${modID}>`,
    { phase: "interaction-handler-error" },
  );
};

export const interactionHandler = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  try {
    logInteractionAckTiming(interaction, { phase: "interaction-handler-entry" });

    // Availability command can run in any channel in the server
    if (interaction.commandName === EAvailabilityCommands.AVAILABILITY) {
      await handleAvailabilityCommand(interaction);
      return;
    }

    // Recording command can run in any channel (permission check happens in handler)
    if (interaction.commandName === ERecordingCommands.RECORD) {
      await handleRecordingCommand(interaction);
      return;
    }

    if (interaction.channelId === attendanceChannelID) {
      if (ELeaveCommands.REQUEST_LEAVE === interaction.commandName) {
        await handleLeaveCommand(interaction);
      } else if (EAuthCommands.HR === interaction.commandName) {
        await handleAuthCommand(interaction);
      }
    } else if (interaction.channelId === process.env.ADMIN_CHANNEL_ID) {
      await handleAdminCommand(interaction);
    } else {
      if (production) {
        await interaction.reply({
          content: `<@${interaction.user.id}> ❌ Please use the <#${attendanceChannelID}> channel for attendance related commands`,
        });
      }
    }
  } catch (error) {
    console.error("Error handling interaction:", error);
    await sendErrorInteractionResponse(interaction);
  }
};
