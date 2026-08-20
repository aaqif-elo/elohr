import type {
  ChatInputCommandInteraction,
  Client,
  TextChannel} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} from "discord.js";
import {
  getAllEmployeesWithAttendance,
  getWeekDateRange,
  listProjects,
  getProjectWorkReport,
  getActiveEmployees,
} from "../../db";

import { generateJWTFromUserDiscordId } from "../../api/routers/auth";
import { formatWorkedDuration } from "../../utils/time";
import { getLatestContract, formatBDT } from "./interaction-handlers/report.utils";

const getLoginUrl = async (discordId: string) => {
  try {
    const jwtResp = await generateJWTFromUserDiscordId(discordId);
    if (!jwtResp?.jwt) return null;
    const loginUrl = `${
      process.env.NODE_ENV === "production"
        ? process.env.FRONTEND_URL
        : `http://localhost:${process.env.PORT}`
    }/?token=${jwtResp.jwt}`;
    return loginUrl;
  } catch (error) {
    console.error("Error generating login link:", error);
    return null;
  }
};

export const getHRLoginInteractionReplyPayload = async (
  interaction: ChatInputCommandInteraction,
  reason?: string
) => {
  try {
    const discordId = interaction.user.id;
    const loginUrl = await getLoginUrl(discordId);
    if (!loginUrl) {
      await interaction.reply({
        content: `❌ Error generating login link. Please try again later.`,
        flags: "Ephemeral",
      });
      return;
    }
    const loginButton = new ButtonBuilder()
      .setLabel("ELO HR Login")
      .setStyle(ButtonStyle.Link)
      .setURL(loginUrl)
      .setEmoji("🌐");

    let message = `<@${discordId}> Please log in to the ELO HR Portal`;
    if (reason) message += ` to ${reason}`;
    message += ` by clicking below:`;

    await interaction.reply({
      content: message,
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(loginButton)],
      flags: "Ephemeral",
    });
  } catch (error) {
    console.error("Error generating HR login link:", error);
    await interaction.reply({
      content: `❌ Error generating login link. Please try again later.`,
      flags: "Ephemeral",
    });
  }
};

export async function sendWeeklyAttendanceReportToAdmin(
  discordClient: Client<boolean>,
  referenceDate: Date = new Date()
) {
  const adminChannelID = process.env.ADMIN_CHANNEL_ID;
  if (!adminChannelID) {
    console.error("ADMIN_CHANNEL_ID not defined");
    return;
  }

  const channel = await discordClient.channels.fetch(adminChannelID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error("Admin channel not found or not a text channel");
    return;
  }

  const { start: weekStart, end: weekEnd } = getWeekDateRange(referenceDate);

  const dayDates: Date[] = [];
  const cursor = new Date(weekStart);
  while (cursor <= weekEnd) {
    const dow = cursor.getDay();
    if (dow >= 0 && dow <= 4) dayDates.push(new Date(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }

  const dailySnapshots = await Promise.all(
    dayDates.map((d) => getAllEmployeesWithAttendance(d))
  );

  type EmployeeDayData = {
    firstSegmentMinutes: number;
    totalHoursMs: number;
    projects: Map<string, number>;
  };

  type EmployeeWeekData = {
    name: string;
    days: Map<string, EmployeeDayData>;
  };

  const employeeMap = new Map<string, EmployeeWeekData>();

  for (let dayIdx = 0; dayIdx < dayDates.length; dayIdx++) {
    const dayIso = dayDates[dayIdx].toISOString().split("T")[0];
    const employees = dailySnapshots[dayIdx] as {
      id: string;
      name: string;
      attendance?: { date: string; workSegments: { start: string; end: string; project: string }[] };
    }[];

    for (const emp of employees) {
      if (!employeeMap.has(emp.id)) {
        employeeMap.set(emp.id, { name: emp.name ?? "Unknown", days: new Map() });
      }
      const empData = employeeMap.get(emp.id);
      if (!empData) continue;

      if (emp.attendance) {
        const segments = Array.isArray(emp.attendance.workSegments)
          ? emp.attendance.workSegments
          : [];

        // First segment start = effective "login" time for the day
        const firstSeg = segments[0];
        const firstSegmentMinutes = firstSeg
          ? new Date(firstSeg.start).getHours() * 60 + new Date(firstSeg.start).getMinutes()
          : 0;

        let totalMs = 0;
        const projMs = new Map<string, number>();

        for (const ws of segments) {
          const s = ws.start ? new Date(ws.start) : null;
          const e = ws.end ? new Date(ws.end) : null;
          if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) continue;
          const diff = e.getTime() - s.getTime();
          if (diff <= 0) continue;
          totalMs += diff;
          const proj = ws.project || "(Unspecified)";
          projMs.set(proj, (projMs.get(proj) || 0) + diff);
        }

        empData.days.set(dayIso, {
          firstSegmentMinutes,
          totalHoursMs: totalMs,
          projects: projMs,
        });
      }
    }
  }

  const toHours = (ms: number) => ms / (1000 * 60 * 60);
  const fmtHours = (hrs: number) => `${hrs.toFixed(1)}h`;

  // Hourly rate per employee (latest contract) drives expense estimates.
  const employees = await getActiveEmployees();
  const rateByUserId = new Map(
    employees.map((e) => [e.id, getLatestContract(e.contracts)?.salaryInBDT ?? 0])
  );

  // Per-project financial breakdown: for each project, every contributing
  // employee's hours and estimated expense (rate × hours).
  type ProjectEmployee = { name: string; hours: number; expense: number };
  type ProjectBreakdown = {
    hours: number;
    expense: number;
    employees: Map<string, ProjectEmployee>;
  };
  const projectBreakdown = new Map<string, ProjectBreakdown>();

  for (const [userId, empData] of employeeMap) {
    const rate = rateByUserId.get(userId) ?? 0;
    for (const dayData of empData.days.values()) {
      for (const [proj, ms] of dayData.projects) {
        const hours = toHours(ms);
        const expense = hours * rate;
        const rec = projectBreakdown.get(proj) ?? {
          hours: 0,
          expense: 0,
          employees: new Map<string, ProjectEmployee>(),
        };
        rec.hours += hours;
        rec.expense += expense;
        const empRec = rec.employees.get(userId) ?? {
          name: empData.name,
          hours: 0,
          expense: 0,
        };
        empRec.hours += hours;
        empRec.expense += expense;
        rec.employees.set(userId, empRec);
        projectBreakdown.set(proj, rec);
      }
    }
  }

  // Projects sorted by spend; employees within each project by their spend.
  const projectsBySpend = [...projectBreakdown.entries()]
    .map(([name, rec]) => ({
      name,
      hours: rec.hours,
      expense: rec.expense,
      employees: [...rec.employees.values()].sort((a, b) => b.expense - a.expense),
    }))
    .sort((a, b) => b.expense - a.expense);

  const totalHoursAll = projectsBySpend.reduce((sum, p) => sum + p.hours, 0);
  const totalExpenseAll = projectsBySpend.reduce((sum, p) => sum + p.expense, 0);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const header = `**Weekly Attendance Report — ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}**`;

  const lines: string[] = [header, ""];

  lines.push("### Projects — Financials");
  if (projectsBySpend.length === 0) {
    lines.push("_No work recorded this week._");
  } else {
    for (const p of projectsBySpend) {
      lines.push(`**${p.name}** — ${fmtHours(p.hours)} · ${formatBDT(p.expense)}`);
      for (const e of p.employees) {
        lines.push(`- ${e.name}: ${fmtHours(e.hours)} · ${formatBDT(e.expense)}`);
      }
      lines.push("");
    }
    lines.push(
      `**Total (all projects)** — ${fmtHours(totalHoursAll)} · ${formatBDT(totalExpenseAll)}`
    );
  }

  const content = lines.join("\n");
  await (channel as TextChannel).send({ content });
}

/**
 * DM each project's manager a summary of that project's work for the week
 * (Sun–Thu). Sent every Thursday night. Managers with DMs closed, or projects
 * with no work, are handled gracefully (the latter still get a short note).
 */
export async function sendWeeklyProjectReportsToManagers(
  discordClient: Client<boolean>,
  referenceDate: Date = new Date()
) {
  const { start: weekStart, end: weekEnd } = getWeekDateRange(referenceDate);
  const projects = await listProjects();

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  const rangeLabel = `${fmtDate(weekStart)} – ${fmtDate(weekEnd)}`;
  const MAX_NOTES_PER_CONTRIBUTOR = 5;

  for (const project of projects) {
    try {
      const report = await getProjectWorkReport(project.name, weekStart, weekEnd);

      const lines: string[] = [
        `📊 **Weekly project report — ${project.name}**`,
        rangeLabel,
        "",
      ];

      if (!report.perEmployee.length) {
        lines.push("No work was logged on this project this week.");
      } else {
        const contributors = report.perEmployee.length;
        lines.push(
          `Total: ${formatWorkedDuration(report.totalMs)} across ${contributors} contributor${contributors > 1 ? "s" : ""}`,
          "",
          "By contributor:"
        );
        for (const { user, totalMs, daysWorked, descriptions } of report.perEmployee) {
          lines.push(
            `• **${user.name}** — ${formatWorkedDuration(totalMs)} (${daysWorked} day${daysWorked > 1 ? "s" : ""})`
          );
          const notes = [...new Set(descriptions)];
          for (const note of notes.slice(0, MAX_NOTES_PER_CONTRIBUTOR)) {
            lines.push(`    – ${note}`);
          }
          if (notes.length > MAX_NOTES_PER_CONTRIBUTOR) {
            lines.push(`    – …and ${notes.length - MAX_NOTES_PER_CONTRIBUTOR} more`);
          }
        }
      }

      const manager = await discordClient.users.fetch(
        project.manager.discordInfo.id
      );
      await manager.send({ content: lines.join("\n") });
    } catch (err) {
      console.error(
        `Failed to send weekly report for project ${project.name}:`,
        err
      );
    }
  }
}
