import { CacheType, ChatInputCommandInteraction } from "discord.js";
import { EAvailabilityCommands } from "../discord.enums";
import { getUserByDiscordId, getWeekdayAvailabilityHeatmap } from "../../../db";
import { discordTimestamp } from "../../../utils/discord";

export const handleAvailabilityCommand = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  if (interaction.commandName !== EAvailabilityCommands.AVAILABILITY) return;

  // Must be used in a guild to reference members reliably
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "❌ This command can only be used in a server.",
      flags: "Ephemeral",
    });
    return;
  }

  // Enforce expected guild if configured
  const expectedGuildId = process.env.DISCORD_SERVER_ID;
  if (expectedGuildId && interaction.guildId !== expectedGuildId) {
    await interaction.reply({
      content: "❌ This command can't be used in this server.",
      flags: "Ephemeral",
    });
    return;
  }

  const target = interaction.options.getUser("user", true);
  const days = interaction.options.getInteger("days") ?? 30;

  await interaction.deferReply({ flags: "Ephemeral" });

  // Resolve to app user id
  let userId: string | null = null;
  try {
    const user = await getUserByDiscordId(target.id);
    userId = user.id;
  } catch {
    await interaction.editReply({
      content: `❌ Couldn't resolve <@${target.id}> to an active employee in the system.`,
    });
    return;
  }

  try {
    // Build an hourly heatmap (0..23) from last N days
    const heatmap = await getWeekdayAvailabilityHeatmap(userId, days, {
      slotMinutes: 60,
    });

    if (!heatmap.heatmap.length) {
      await interaction.editReply({
        content: `ℹ️ Not enough data to estimate active times for <@${target.id}> in the last ${days} days.`,
      });
      return;
    }

    const toAMPM = (hour24: number): string => {
      const period = hour24 >= 12 ? "PM" : "AM";
      const h12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
      return `${String(h12).padStart(2, "0")}:00 ${period}`;
    };

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const hours = Array.from({ length: 24 }, (_, h) => h);

    const BAR_WIDTH = 10;
    const rows = hours.map((hour) => {
      const startMinutes = hour * 60;
      const slot = heatmap.heatmap.find((s) => s.startMinutes === startMinutes);
      const confidence = slot ? slot.confidence : 0;
      const levelChar = confidence >= 0.66 ? "▓" : confidence >= 0.33 ? "▒" : "░";
      const filled = Math.round(confidence * BAR_WIDTH);
      const bar = filled > 0 ? levelChar.repeat(filled).padEnd(BAR_WIDTH, " ") : " ".repeat(BAR_WIDTH);

      const d = new Date(today);
      d.setHours(hour, 0, 0, 0);
      const human = toAMPM(hour);
      const pretty = discordTimestamp(d, "t");
      const pct = `${Math.round(confidence * 100)}%`;
      return `${human} ${pretty} ${bar} ${pct}`;
    });

    const header = `📊 Availability heatmap for <@${target.id}> (last ${days} days, hourly avg):`;
    await interaction.editReply({
      content: `${header}\n${rows.join("\n")}`,
    });
  } catch (e) {
    console.error("/availability error", e);
    await interaction.editReply({ content: "❌ Failed to compute availability." });
  }
};
