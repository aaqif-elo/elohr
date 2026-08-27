import type {
  AutocompleteInteraction,
  CacheType,
  ChatInputCommandInteraction,
} from "discord.js";
import { AttachmentBuilder } from "discord.js";
import type { User } from "@prisma/client";
import { EReportCommands } from "../discord.enums";
import {
  getUserByDiscordId,
  getMonthlyWorkReport,
  getMonthlyWorkReportForAllEmployees,
  getWorkSegmentBreakdown,
} from "../../../db";
import { formatWorkedDuration } from "../../../utils/time";
import {
  MS_PER_HOUR,
  getLatestContract,
  formatBDT,
  rowsToCsv,
  buildWorkBreakdownCsv,
  resolveMonthRange,
  recentMonthChoices,
} from "./report.utils";
import type { MonthRange } from "./report.utils";

/**
 * Admin-only: build a downloadable CSV of every employee's work this month,
 * with estimated pay derived from each employee's latest contract rate, plus a
 * TOTAL row for the overall cost of work. Used to disburse payments.
 */
const sendAllEmployeesCsvReport = async (
  interaction: ChatInputCommandInteraction<CacheType>,
  reportDate: Date
) => {
  const now = reportDate;
  const monthLabel = now.toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });

  const reports = await getMonthlyWorkReportForAllEmployees(now);
  const worked = reports
    .filter((report) => report.totalMs > 0)
    .map((report) => {
      const totalHours = report.totalMs / MS_PER_HOUR;
      const rate = getLatestContract(report.user.contracts)?.salaryInBDT;
      const pay = rate !== undefined ? totalHours * rate : undefined;
      return { ...report, totalHours, rate, pay };
    })
    // Sort by estimated pay, most to least; employees without a contract rate
    // (no computable pay) sort to the bottom.
    .sort((a, b) => (b.pay ?? 0) - (a.pay ?? 0));

  if (!worked.length) {
    await interaction.editReply({
      content: `ℹ️ No employees logged work in ${monthLabel}.`,
    });
    return;
  }

  const header = [
    "Employee",
    "Discord Username",
    "Days Worked",
    "Total Hours",
    "Hourly Rate (BDT)",
    "Estimated Pay (BDT)",
    "Projects",
  ];
  const rows: string[][] = [header];

  let totalHoursAll = 0;
  let totalPayAll = 0;

  for (const { user, daysWorked, perProject, totalHours, rate, pay } of worked) {
    totalHoursAll += totalHours;
    if (pay !== undefined) totalPayAll += pay;

    const projects = perProject
      .map((p) => `${p.project} (${(p.ms / MS_PER_HOUR).toFixed(2)}h)`)
      .join("; ");

    rows.push([
      user.name,
      user.discordInfo.username,
      String(daysWorked),
      totalHours.toFixed(2),
      rate !== undefined ? String(rate) : "",
      pay !== undefined ? pay.toFixed(2) : "",
      projects,
    ]);
  }

  rows.push([
    "TOTAL",
    "",
    "",
    totalHoursAll.toFixed(2),
    "",
    totalPayAll.toFixed(2),
    "",
  ]);

  // Second section: the same work aggregated by project, each project listing
  // its contributors in brackets (inverse of the per-employee view above).
  const projectAgg = new Map<
    string,
    { hours: number; cost: number; contributors: { name: string; hours: number }[] }
  >();
  for (const { user, perProject, rate } of worked) {
    for (const { project, ms } of perProject) {
      const hours = ms / MS_PER_HOUR;
      const entry = projectAgg.get(project) ?? { hours: 0, cost: 0, contributors: [] };
      entry.hours += hours;
      if (rate !== undefined) entry.cost += hours * rate;
      entry.contributors.push({ name: user.name, hours });
      projectAgg.set(project, entry);
    }
  }

  const projectRows = [...projectAgg.entries()]
    .map(([project, agg]) => ({ project, ...agg }))
    .sort((a, b) => b.cost - a.cost || b.hours - a.hours);

  rows.push([""]);
  rows.push(["Project", "Total Hours", "Estimated Cost (BDT)", "Employees"]);
  for (const p of projectRows) {
    const employees = [...p.contributors]
      .sort((a, b) => b.hours - a.hours)
      .map((c) => `${c.name} (${c.hours.toFixed(2)}h)`)
      .join("; ");
    rows.push([p.project, p.hours.toFixed(2), p.cost.toFixed(2), employees]);
  }
  rows.push(["TOTAL", totalHoursAll.toFixed(2), totalPayAll.toFixed(2), ""]);

  const csv = rowsToCsv(rows);
  const fileName = `work-report-${now.getFullYear()}-${String(
    now.getMonth() + 1
  ).padStart(2, "0")}.csv`;
  const attachment = new AttachmentBuilder(Buffer.from(csv, "utf-8"), {
    name: fileName,
  });

  const summary =
    `📊 **Monthly work report — ${monthLabel}**\n` +
    `Employees with work: ${worked.length} • Total hours: ${totalHoursAll.toFixed(2)} • ` +
    `Estimated total cost: ${formatBDT(totalPayAll)}`;

  await interaction.editReply({ content: summary, files: [attachment] });
};

/**
 * Admin-only: task-wise CSV for one employee — one row per work segment across
 * all their projects for the given month (Date, Project, Task Description,
 * Start/End Time, Hours Spent, Earnings), plus a TOTAL row.
 */
const sendEmployeeBreakdownCsvReport = async (
  interaction: ChatInputCommandInteraction<CacheType>,
  target: User,
  monthRange: MonthRange
) => {
  const { rows } = await getWorkSegmentBreakdown(
    { userId: target.id },
    monthRange.rangeStart,
    monthRange.rangeEnd
  );

  if (!rows.length) {
    await interaction.editReply({
      content: `ℹ️ No work logged by **${target.name}** in ${monthRange.monthLabel}.`,
    });
    return;
  }

  const { csv, totalMs, totalEarnings } = buildWorkBreakdownCsv(rows, {
    includeEmployeeColumn: false,
  });

  const safeName = target.name.replace(/[^a-z0-9-_]+/gi, "_");
  const fileName = `report-${safeName}-${monthRange.monthKey}.csv`;
  const attachment = new AttachmentBuilder(Buffer.from(csv, "utf-8"), {
    name: fileName,
  });

  const summary =
    `📊 **${target.name} — ${monthRange.monthLabel}**\n` +
    `Tasks: ${rows.length} • Total hours: ${(totalMs / MS_PER_HOUR).toFixed(2)} • ` +
    `Estimated earnings: ${formatBDT(totalEarnings)}`;

  await interaction.editReply({ content: summary, files: [attachment] });
};

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

  const monthRange = resolveMonthRange(interaction.options.getString("month"));
  if ("error" in monthRange) {
    await interaction.editReply({ content: monthRange.error });
    return;
  }

  // Admins can pass `employee` to pull anyone's task-wise breakdown CSV.
  const targetUser = interaction.options.getUser("employee");
  if (targetUser) {
    if (!user.isAdmin) {
      await interaction.editReply({
        content: "❌ Only admins can pull another employee's report.",
      });
      return;
    }

    let target: User;
    try {
      target = await getUserByDiscordId(targetUser.id);
    } catch {
      await interaction.editReply({
        content: `❌ Couldn't resolve <@${targetUser.id}> to an employee in the system.`,
      });
      return;
    }

    try {
      await sendEmployeeBreakdownCsvReport(interaction, target, monthRange);
    } catch (e) {
      console.error("/report employee breakdown error", e);
      await interaction.editReply({
        content: "❌ Failed to build the employee work report.",
      });
    }
    return;
  }

  // In the admin channel, an admin gets a downloadable CSV covering everyone.
  const isAdminChannel = interaction.channelId === process.env.ADMIN_CHANNEL_ID;
  if (isAdminChannel && user.isAdmin) {
    try {
      await sendAllEmployeesCsvReport(interaction, monthRange.rangeStart);
    } catch (e) {
      console.error("/report admin csv error", e);
      await interaction.editReply({
        content: "❌ Failed to build the monthly work report.",
      });
    }
    return;
  }

  try {
    const report = await getMonthlyWorkReport(user.id, monthRange.rangeStart);
    const monthLabel = monthRange.monthLabel;

    if (report.totalMs <= 0) {
      await interaction.editReply({
        content: `ℹ️ No work logged yet for ${monthLabel}.`,
      });
      return;
    }

    const hourlyRate = getLatestContract(user.contracts)?.salaryInBDT;
    const msToSalary = (ms: number): number =>
      (ms / MS_PER_HOUR) * (hourlyRate ?? 0);

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
      const totalHours = report.totalMs / MS_PER_HOUR;
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

/**
 * Autocomplete for `/report` — only the `month` option is autocompleted, offering
 * the current and recent calendar months.
 */
export const handleReportAutocomplete = async (
  interaction: AutocompleteInteraction<CacheType>
) => {
  if (interaction.commandName !== EReportCommands.REPORT) return;
  if (interaction.options.getFocused(true).name !== "month") {
    await interaction.respond([]);
    return;
  }

  const query = interaction.options.getFocused().trim().toLowerCase();
  const choices = recentMonthChoices().filter(
    (choice) =>
      choice.name.toLowerCase().includes(query) || choice.value.includes(query)
  );
  await interaction.respond(choices);
};
