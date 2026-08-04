import type {
  ButtonInteraction,
  CacheType,
  ModalSubmitInteraction,
} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import { setWorkSegmentDescription } from "../../../db";

// customId shapes: `<prefix>:<attendanceId>:<segmentStartMs>`. Segments have no
// id of their own, so the parent attendance id + start time locate them.
const BUTTON_PREFIX = "wsdesc_btn";
const MODAL_PREFIX = "wsdesc_modal";
const DESCRIPTION_INPUT_ID = "description";
const MAX_DESCRIPTION_LENGTH = 500;

export const isWorkSegmentDescriptionButton = (customId: string): boolean =>
  customId.startsWith(`${BUTTON_PREFIX}:`);

export const isWorkSegmentDescriptionModal = (customId: string): boolean =>
  customId.startsWith(`${MODAL_PREFIX}:`);

/**
 * Build the "add description" button attached to an ended-segment DM. Clicking
 * it opens the modal below (a modal can only be shown from an interaction, so
 * a button is the required first step).
 */
export const buildDescriptionButton = (
  attendanceId: string,
  segmentStartMs: number,
): ActionRowBuilder<ButtonBuilder> =>
  new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}:${attendanceId}:${segmentStartMs}`)
      .setLabel("Add description")
      .setEmoji("📝")
      .setStyle(ButtonStyle.Secondary),
  );

// Split off the two id fields, tolerating unexpected shapes.
const parseCustomId = (
  customId: string,
): { attendanceId: string; segmentStartMs: number } | null => {
  const [, attendanceId, startMs] = customId.split(":");
  const segmentStartMs = Number(startMs);
  if (!attendanceId || !Number.isFinite(segmentStartMs)) return null;
  return { attendanceId, segmentStartMs };
};

export const handleWorkSegmentDescriptionButton = async (
  interaction: ButtonInteraction<CacheType>,
) => {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      content: "❌ This button is no longer valid.",
      flags: "Ephemeral",
    });
    return;
  }

  const modal = new ModalBuilder()
    .setCustomId(
      `${MODAL_PREFIX}:${parsed.attendanceId}:${parsed.segmentStartMs}`,
    )
    .setTitle("What did you work on?")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Task / description")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId(DESCRIPTION_INPUT_ID)
            .setPlaceholder("e.g. Implemented the work-channels feature")
            .setStyle(TextInputStyle.Paragraph)
            .setMaxLength(MAX_DESCRIPTION_LENGTH)
            .setRequired(true),
        ),
    );

  await interaction.showModal(modal);
};

export const handleWorkSegmentDescriptionModal = async (
  interaction: ModalSubmitInteraction<CacheType>,
) => {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      content: "❌ Couldn't save — this form is no longer valid.",
      flags: "Ephemeral",
    });
    return;
  }

  const description = interaction.fields
    .getTextInputValue(DESCRIPTION_INPUT_ID)
    .trim();

  const result = await setWorkSegmentDescription(
    parsed.attendanceId,
    parsed.segmentStartMs,
    description,
  );

  if (!result) {
    await interaction.reply({
      content: "❌ Couldn't find that work segment to update.",
      flags: "Ephemeral",
    });
    return;
  }

  // If the modal was opened from a DM message, replace the button with a
  // confirmation so it can't be submitted twice; otherwise just acknowledge.
  const confirmation = `📝 Saved your description for **${result.project}**:\n> ${description}`;
  if (interaction.isFromMessage()) {
    await interaction.update({ content: confirmation, components: [] });
  } else {
    await interaction.reply({ content: confirmation, flags: "Ephemeral" });
  }
};
