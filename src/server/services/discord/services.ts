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
  countWorkingDays,
} from "../../db";

import { generateJWTFromUserDiscordId } from "../../api/routers/auth";

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

// Outlier detection thresholds (office hours: 10 AM – 6 PM)
const LATE_THRESHOLD_MINUTES = 10 * 60 + 30; // 10:30 AM in minutes
const LATE_MIN_DAYS = 3;
const HOURS_DEVIATION_THRESHOLD = 0.2;
const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

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
  const workingDays = countWorkingDays(weekStart, weekEnd);

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

  const workingDayDates = dayDates;

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
  const minutesToTimeStr = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
  };
  const median = (nums: number[]) => {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  };
  const fmtDateShort = (isoDate: string) => {
    const d = new Date(isoDate);
    return SHORT_DAY_NAMES[d.getDay()];
  };

  type EmployeeStats = {
    name: string;
    daysPresent: number;
    daysAbsent: number;
    totalHours: number;
    avgFirstSegmentMinutes: number;
    lateDays: number;
    absentDayNames: string[];
  };

  const employeeStats: EmployeeStats[] = [];
  const allWeeklyHours: number[] = [];
  const allFirstSegmentMinutes: number[] = [];
  const projectTotals = new Map<string, { hours: number; employeeIds: Set<string> }>();
  const teamSize = employeeMap.size;
  let totalPersonDaysPresent = 0;

  for (const [userId, empData] of employeeMap) {
    const daysPresent = empData.days.size;
    const daysAbsent = workingDays - daysPresent;
    const totalHoursMs = [...empData.days.values()].reduce(
      (sum, d) => sum + d.totalHoursMs,
      0
    );
    const totalHours = toHours(totalHoursMs);
    const firstSegMinutesList = [...empData.days.values()].map((d) => d.firstSegmentMinutes);
    const avgFirstSegmentMinutes = firstSegMinutesList.length
      ? firstSegMinutesList.reduce((a, b) => a + b, 0) / firstSegMinutesList.length
      : 0;
    const lateDays = firstSegMinutesList.filter((m) => m > LATE_THRESHOLD_MINUTES).length;

    const absentDayNames: string[] = [];
    for (const wd of workingDayDates) {
      const iso = wd.toISOString().split("T")[0];
      if (!empData.days.has(iso)) absentDayNames.push(fmtDateShort(iso));
    }

    employeeStats.push({
      name: empData.name,
      daysPresent,
      daysAbsent: Math.max(0, daysAbsent),
      totalHours,
      avgFirstSegmentMinutes,
      lateDays,
      absentDayNames,
    });

    if (daysPresent > 0) {
      allWeeklyHours.push(totalHours);
      allFirstSegmentMinutes.push(...firstSegMinutesList);
    }
    totalPersonDaysPresent += daysPresent;

    for (const dayData of empData.days.values()) {
      for (const [proj, ms] of dayData.projects) {
        const hrs = toHours(ms);
        const rec = projectTotals.get(proj) || { hours: 0, employeeIds: new Set<string>() };
        rec.hours += hrs;
        rec.employeeIds.add(userId);
        projectTotals.set(proj, rec);
      }
    }
  }

  const totalPersonDays = teamSize * workingDays;
  const attendanceRate =
    totalPersonDays > 0
      ? ((totalPersonDaysPresent / totalPersonDays) * 100).toFixed(0)
      : "0";
  const medianWeeklyHours = median(allWeeklyHours);
  const avgDailyHours =
    allWeeklyHours.length > 0
      ? allWeeklyHours.reduce((a, b) => a + b, 0) / allWeeklyHours.length / workingDays
      : 0;
  const medianFirstSegMinutes = median(allFirstSegmentMinutes);

  const absent = employeeStats
    .filter((e) => e.daysAbsent > 0)
    .sort((a, b) => b.daysAbsent - a.daysAbsent);
  const consistentlyLate = employeeStats
    .filter(
      (e) =>
        e.lateDays >= LATE_MIN_DAYS && e.avgFirstSegmentMinutes > LATE_THRESHOLD_MINUTES
    )
    .sort((a, b) => b.avgFirstSegmentMinutes - a.avgFirstSegmentMinutes);
  const aboveAvgHours =
    medianWeeklyHours > 0
      ? employeeStats
          .filter(
            (e) =>
              e.daysPresent > 0 &&
              e.totalHours > medianWeeklyHours * (1 + HOURS_DEVIATION_THRESHOLD)
          )
          .sort((a, b) => b.totalHours - a.totalHours)
      : [];
  const belowAvgHours =
    medianWeeklyHours > 0
      ? employeeStats
          .filter(
            (e) =>
              e.daysPresent > 0 &&
              e.totalHours < medianWeeklyHours * (1 - HOURS_DEVIATION_THRESHOLD)
          )
          .sort((a, b) => a.totalHours - b.totalHours)
      : [];
  const perfectAttendance = employeeStats
    .filter(
      (e) =>
        e.daysPresent === workingDays &&
        e.daysAbsent === 0 &&
        e.avgFirstSegmentMinutes <= LATE_THRESHOLD_MINUTES
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  const sortedProjects = [...projectTotals.entries()]
    .map(([name, rec]) => ({ name, hours: rec.hours, employees: rec.employeeIds.size }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const header = `**Weekly Attendance Report — ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}**`;

  const lines: string[] = [header, ""];

  lines.push("### Overview");
  lines.push(`- Team Size: ${teamSize} | Working Days: ${workingDays}`);
  lines.push(
    `- Attendance Rate: ${attendanceRate}% (${totalPersonDaysPresent}/${totalPersonDays} person-days)`
  );
  lines.push(
    `- Avg Daily Hours: ${fmtHours(avgDailyHours)} | Median First Segment: ${minutesToTimeStr(medianFirstSegMinutes)}`
  );
  lines.push("");

  const hasHighlights =
    absent.length > 0 ||
    consistentlyLate.length > 0 ||
    aboveAvgHours.length > 0 ||
    belowAvgHours.length > 0 ||
    perfectAttendance.length > 0;

  if (hasHighlights) {
    lines.push("### Highlights");

    if (absent.length > 0) {
      lines.push("🔴 **Absences** (no work segments)");
      for (const e of absent) {
        lines.push(
          `- ${e.name}: ${e.absentDayNames.join(", ")} (${e.daysAbsent} day${e.daysAbsent > 1 ? "s" : ""})`
        );
      }
      lines.push("");
    }

    if (consistentlyLate.length > 0) {
      lines.push("⏰ **Consistently Late** (first segment after 10:30 AM on 3+ days)");
      for (const e of consistentlyLate) {
        lines.push(
          `- ${e.name}: avg start ${minutesToTimeStr(e.avgFirstSegmentMinutes)} (${e.lateDays} day${e.lateDays > 1 ? "s" : ""} late)`
        );
      }
      lines.push("");
    }

    if (aboveAvgHours.length > 0) {
      lines.push("📈 **Above Average Hours** (>20% above team median)");
      for (const e of aboveAvgHours) {
        const pct = (
          ((e.totalHours - medianWeeklyHours) / medianWeeklyHours) * 100
        ).toFixed(0);
        lines.push(`- ${e.name}: ${fmtHours(e.totalHours)} total — ${pct}% above median`);
      }
      lines.push("");
    }

    if (belowAvgHours.length > 0) {
      lines.push("📉 **Below Average Hours** (>20% below team median)");
      for (const e of belowAvgHours) {
        const pct = (
          ((medianWeeklyHours - e.totalHours) / medianWeeklyHours) * 100
        ).toFixed(0);
        lines.push(`- ${e.name}: ${fmtHours(e.totalHours)} total — ${pct}% below median`);
      }
      lines.push("");
    }

    if (perfectAttendance.length > 0) {
      lines.push("⭐ **Perfect Attendance** (all days, on time)");
      lines.push(`- ${perfectAttendance.map((e) => e.name).join(", ")}`);
      lines.push("");
    }
  }

  if (sortedProjects.length > 0) {
    lines.push("### Projects");
    for (const p of sortedProjects) {
      lines.push(
        `- ${p.name}: ${fmtHours(p.hours)} (${p.employees} employee${p.employees > 1 ? "s" : ""})`
      );
    }
    lines.push("");
  }

  const content = lines.join("\n");
  await (channel as TextChannel).send({ content });
}
