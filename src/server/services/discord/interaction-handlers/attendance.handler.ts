import { setNameStatus } from "../utils";
import { logoutCommandHandler, breakCommandHandler } from "../commands";
import {
  EAttendanceCommands,
  ESlashCommandOptionNames,
  EAutoBreakReason,
} from "../discord.enums";
import { Client, ChatInputCommandInteraction, CacheType } from "discord.js";
import { canBreakOrResume, getUserByDiscordId } from "../../../db";

export const handleAttendanceCommand = async (
  interaction: ChatInputCommandInteraction<CacheType>,
  discordClient: Client,
  sendErrorInteractionResponse: (
    interaction: ChatInputCommandInteraction<CacheType>
  ) => Promise<void>
) => {
  let user = await getUserByDiscordId(interaction.user.id);
  if (!user) {
    interaction.reply({
      content: `<@${interaction.user.id}> ❌ You are not registered in the system. Please contact an admin to register.`,
    });
    return;
  }
  switch (interaction.commandName) {
    case EAttendanceCommands.LOGOUT: {
      const sendReport = (report: Buffer<ArrayBuffer> | string) => {
        try {
          if (typeof report === "string") {
            interaction.user.send(report);
          } else {
            interaction.user.send({
              files: [report],
            });
          }
        } catch (err) {
          console.error(err);
        }
      };
      const logoutMsg = await logoutCommandHandler(
        user.id,
        interaction.createdTimestamp,
        sendReport
      );
      if (logoutMsg !== ``) {
        interaction.reply({
          content: `<@${interaction.user.id}> ${logoutMsg}`,
        });

        if (logoutMsg.includes("Success")) {
          await setNameStatus(
            discordClient,
            process.env.STATUS_TAG_UNAVAILABLE || "X",
            interaction.user.id
          );
        }
      } else {
        sendErrorInteractionResponse(interaction);
      }
      break;
    }

    default: {
      const canBreakOrResumeResp = await canBreakOrResume(user.id);
      if (canBreakOrResumeResp !== true) {
        interaction.reply({
          content: `<@${interaction.user.id}> ${canBreakOrResumeResp}`,
        });
        return;
      } else {
        if (
          (interaction.commandName as EAttendanceCommands) ===
          EAttendanceCommands.BREAK
        ) {
          const reason =
            interaction.options.get(ESlashCommandOptionNames.BREAK_REASON)
              ?.value || "Kit Kat";

          if (
            [EAutoBreakReason.AFK, EAutoBreakReason.NO_VOICE_CHANNEL].includes(
              reason as EAutoBreakReason
            )
          ) {
            return interaction.reply({
              content: `<@${interaction.user.id}> ❌ Error starting break! Please don't use auto-break reasons...`,
            });
          }
          const breakMsg = await breakCommandHandler(
            user.id,
            reason.toString()
          );
          if (breakMsg !== ``) {
            interaction.reply({
              content: `<@${interaction.user.id}> ${breakMsg}`,
            });
            // Only change status on success
            if (!breakMsg.includes("You are already on")) {
              await setNameStatus(
                discordClient,
                process.env.STATUS_TAG_BREAK || "BRK",
                interaction.user.id
              );
            }
          } else {
            sendErrorInteractionResponse(interaction);
          }
          break;
        }
      }
    }
  }
};
