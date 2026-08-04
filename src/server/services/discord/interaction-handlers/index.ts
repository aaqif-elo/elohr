import type { AutocompleteInteraction, ButtonInteraction, CacheType, ChatInputCommandInteraction, ModalSubmitInteraction } from "discord.js";
import { EAuthCommands, EAvailabilityCommands, EProjectCommands, ERecordingCommands, EReportCommands } from "../discord.enums";
import { handleAuthCommand } from "./auth.handler";
import { handleAvailabilityCommand } from "./availability.handler";
import { handleRecordingCommand } from "./recording.handler";
import { handleReportCommand } from "./report.handler";
import { handleProjectCommand, handleProjectAutocomplete } from "./project.handler";
import {
  isWorkSegmentDescriptionButton,
  handleWorkSegmentDescriptionButton,
  isWorkSegmentDescriptionModal,
  handleWorkSegmentDescriptionModal,
} from "./worksegment-description.handler";
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

// Route button clicks to the feature that owns their customId.
export const buttonHandler = async (
  interaction: ButtonInteraction<CacheType>
) => {
  try {
    if (isWorkSegmentDescriptionButton(interaction.customId)) {
      await handleWorkSegmentDescriptionButton(interaction);
    }
  } catch (error) {
    console.error("Error handling button interaction:", error);
  }
};

// Route modal submissions to the feature that owns their customId.
export const modalSubmitHandler = async (
  interaction: ModalSubmitInteraction<CacheType>
) => {
  try {
    if (isWorkSegmentDescriptionModal(interaction.customId)) {
      await handleWorkSegmentDescriptionModal(interaction);
    }
  } catch (error) {
    console.error("Error handling modal submit:", error);
  }
};

// Route autocomplete requests to the command that owns them.
export const autocompleteHandler = async (
  interaction: AutocompleteInteraction<CacheType>
) => {
  try {
    if (interaction.commandName === EProjectCommands.PROJECT) {
      await handleProjectAutocomplete(interaction);
    }
  } catch (error) {
    console.error("Error handling autocomplete:", error);
  }
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

    // Personal report can run in any channel (reply is ephemeral)
    if (interaction.commandName === EReportCommands.REPORT) {
      await handleReportCommand(interaction);
      return;
    }

    // Project management (admin-channel enforcement happens in the handler)
    if (interaction.commandName === EProjectCommands.PROJECT) {
      await handleProjectCommand(interaction);
      return;
    }

    if (interaction.channelId === attendanceChannelID) {
      if (EAuthCommands.HR === interaction.commandName) {
        await handleAuthCommand(interaction);
      }
    } else if (interaction.channelId === process.env.ADMIN_CHANNEL_ID) {
      await interaction.reply({
        content: `<@${interaction.user.id}> ❌ Invalid command!`,
        flags: "Ephemeral",
      });
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
