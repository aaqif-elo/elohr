import { ELeaveCommands } from "../discord.enums";
import { getHRLoginInteractionReplyPayload } from "../services";
import { ChatInputCommandInteraction, CacheType } from "discord.js";

export const handleLeaveCommand = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  switch (interaction.commandName) {
    case ELeaveCommands.REQUEST_LEAVE: {
      await getHRLoginInteractionReplyPayload(interaction, "request a leave");
      break;
    }

    default: {
      break;
    }
  }
};
