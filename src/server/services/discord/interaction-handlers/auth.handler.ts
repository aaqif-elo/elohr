import { EAuthCommands } from "../discord.enums";
import { getHRLoginInteractionReplyPayload } from "../services";
import { ChatInputCommandInteraction, CacheType } from "discord.js";

export const handleAuthCommand = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  switch (interaction.commandName) {
    case EAuthCommands.HR: {
      await getHRLoginInteractionReplyPayload(interaction);

      break;
    }

    default: {
      break;
    }
  }
};
