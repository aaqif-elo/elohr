import type { CacheType, ChatInputCommandInteraction } from "discord.js";

const UNKNOWN_INTERACTION_ERROR_CODE = 10062;
const INTERACTION_ACK_WARNING_THRESHOLD_MS = 2_500;

interface InteractionResponseMetadata {
  phase: string;
  subcommand?: string;
}

interface InteractionRunResult<T> {
  ok: boolean;
  value?: T;
}

function getInteractionAgeMs(
  interaction: ChatInputCommandInteraction<CacheType>,
): number {
  return Date.now() - interaction.createdTimestamp;
}

function getInteractionLogContext(
  interaction: ChatInputCommandInteraction<CacheType>,
  metadata: InteractionResponseMetadata,
) {
  return {
    channelId: interaction.channelId,
    commandName: interaction.commandName,
    deferred: interaction.deferred,
    guildId: interaction.guildId,
    interactionAgeMs: getInteractionAgeMs(interaction),
    phase: metadata.phase,
    replied: interaction.replied,
    subcommand: metadata.subcommand,
    userId: interaction.user.id,
  };
}

function isUnknownInteractionError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === UNKNOWN_INTERACTION_ERROR_CODE
  );
}

export function logInteractionAckTiming(
  interaction: ChatInputCommandInteraction<CacheType>,
  metadata: InteractionResponseMetadata,
): void {
  const logContext = getInteractionLogContext(interaction, metadata);
  if (logContext.interactionAgeMs < INTERACTION_ACK_WARNING_THRESHOLD_MS) {
    return;
  }

  console.warn(
    "[Discord] Interaction acknowledgement is close to timing out",
    logContext,
  );
}

export async function runInteractionResponse<T>(
  interaction: ChatInputCommandInteraction<CacheType>,
  action: () => Promise<T>,
  metadata: InteractionResponseMetadata,
): Promise<InteractionRunResult<T>> {
  try {
    const value = await action();
    return { ok: true, value };
  } catch (error) {
    if (isUnknownInteractionError(error)) {
      console.warn(
        "[Discord] Interaction expired before a response could be sent",
        getInteractionLogContext(interaction, metadata),
      );
      return { ok: false };
    }

    throw error;
  }
}

export async function sendInteractionErrorResponse(
  interaction: ChatInputCommandInteraction<CacheType>,
  content: string,
  metadata: InteractionResponseMetadata,
): Promise<void> {
  if (interaction.deferred) {
    await runInteractionResponse(
      interaction,
      () => interaction.editReply({ content }),
      {
        ...metadata,
        phase: `${metadata.phase}:editReply`,
      },
    );
    return;
  }

  if (interaction.replied) {
    return;
  }

  await runInteractionResponse(
    interaction,
    () =>
      interaction.reply({
        content,
        flags: "Ephemeral",
      }),
    {
      ...metadata,
      phase: `${metadata.phase}:reply`,
    },
  );
}