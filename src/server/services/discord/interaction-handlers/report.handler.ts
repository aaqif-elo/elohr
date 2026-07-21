import type { CacheType, ChatInputCommandInteraction } from "discord.js";
import type { Contract, User } from "@prisma/client";
import { EReportCommands } from "../discord.enums";
import { getUserByDiscordId, getMonthlyWorkReport } from "../../../db";
import { formatWorkedDuration } from "../../../utils/time";

// The user's most recent contract by start date holds their current rate.
const getLatestContract = (contracts: Contract[]): Contract | undefined => {
  if (!contracts.length) return undefined;
  return [...contracts].sort(
    (a, b) => b.startDate.getTime() - a.startDate.getTime()
  )[0];
};

const formatBDT = (amount: number): string =>
  `৳${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const handleReportCommand = async (
  interaction: ChatInputCommandInteraction<CacheType>
) => {
  if (interaction.commandName !== EReportCommands.REPORT) return;

  await interaction.deferReply({ flags: "Ephemeral" });

  // Resolve the invoking Discord user to an app user
  let user: User;
  try {
    user = await getUserByDiscordId(interaction.user.id);
  } catch {
    await interaction.editReply({
      content: "❌ Couldn't find your employee record in the system.",
    });
    return;
  }

  try {
    const now = new Date();
    const report = await getMonthlyWorkReport(user.id, now);
    const monthLabel = now.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });

    if (report.totalMs <= 0) {
      await interaction.editReply({
        content: `ℹ️ No work logged yet for ${monthLabel}.`,
      });
      return;
    }

    const hourlyRate = getLatestContract(user.contracts)?.salaryInBDT;
    const msToSalary = (ms: number): number =>
      (ms / 3600000) * (hourlyRate ?? 0);

    const lines: string[] = [
      `📊 **Work report — ${monthLabel}**`,
      "",
      `Total: ${formatWorkedDuration(report.totalMs)}`,
      `Days worked: ${report.daysWorked}`,
    ];

    // Only break down by project when there's more than one to show
    if (report.perProject.length > 1) {
      lines.push("", "By project:");
      for (const { project, ms } of report.perProject) {
        const salarySuffix =
          hourlyRate !== undefined ? ` — ${formatBDT(msToSalary(ms))}` : "";
        lines.push(
          `  • ${project} — ${formatWorkedDuration(ms)}${salarySuffix}`
        );
      }
    }

    if (hourlyRate !== undefined) {
      const totalHours = report.totalMs / 3600000;
      lines.push(
        "",
        `Estimated salary: ${formatBDT(msToSalary(report.totalMs))} (${totalHours.toFixed(2)} hrs × ৳${hourlyRate.toLocaleString("en-US")}/hr)`
      );
    } else {
      lines.push("", "ℹ️ No contract on file to estimate salary.");
    }

    await interaction.editReply({ content: lines.join("\n") });
  } catch (e) {
    console.error("/report error", e);
    await interaction.editReply({
      content: "❌ Failed to compute your work report.",
    });
  }
};
