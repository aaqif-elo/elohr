import type {
  ChatInputCommandInteraction,
  Client,
  TextChannel,
  User} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} from "discord.js";
import {
  generateAttendanceImageReport,
  getDiscordIdsFromUserIds,
  getLoggedInUsers,
  logout,
  getAllEmployeesWithAttendance,
  getLeavesInDateRange,
  getWeekDateRange,
  countWorkingDays,
} from "../../db";

import { generateJWTFromUserDiscordId } from "../../api/routers/auth";
import { clearNameStatus } from "./utils";

const getLoginUrl = async (discordId: string) => {
  try {
    // new: actually generate the signed JWT
    const jwtResp = await generateJWTFromUserDiscordId(discordId);
    if (!jwtResp?.jwt) {
      return null;
    }
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

export const autoLogoutUsersWhoAreStillLoggedIn = async (
  discordClient: Client<boolean>
) => {
  const attendanceChannelID =
    process.env.NODE_ENV === "production"
      ? process.env.ATTENDANCE_CHANNEL_ID
      : process.env.TEST_CHANNEL_ID;
  if (!attendanceChannelID) {
    return;
  }

  const attendanceChannel =
    discordClient.channels.cache.get(attendanceChannelID);

  if (!attendanceChannel || attendanceChannel.type !== ChannelType.GuildText) {
    return;
  }

  // Get the list of users (by mongo ID) who are currently logged in
  const userIds = await getLoggedInUsers();
  const discordIds = await getDiscordIdsFromUserIds(userIds);
  if (!userIds.length) {
    return;
  }
  await attendanceChannel.send(`Auto-logout Initiated...`);
  const today = new Date(); // Capture current date
  const logoutPromises = userIds.map(async (userId) => {
    try {
      const discordId = discordIds.find((d) => d.id === userId)?.discordId;

      if (!discordId) {
        return;
      }
      const logoutInfo = await logout(userId);

      if (!logoutInfo) {
        return;
      }

      await clearNameStatus(discordId);

      const fetchedUser = await discordClient.users.fetch(discordId);

      const imageReportPromise = generateAttendanceImageReport(userId, today);
      await sendLogoutReport(
        fetchedUser,
        logoutInfo.textReport,
        imageReportPromise
      );

      return { discordId, userId };
    } catch (err) {
      console.error("Error during auto-logout:", err);
      return null;
    }
  });

  await Promise.all(logoutPromises);
};

const sendLogoutReport = async (
  user: User,
  textReportOrBuffer: string | Buffer,
  imageReportPromise?: Promise<Buffer | null>
): Promise<void> => {
  const loginUrl = await getLoginUrl(user.id);

  if (!loginUrl) {
    console.error("Error generating login link for user:", user.id);
    return;
  }

  const hrLoginButton = new ButtonBuilder()
    .setLabel("ELO HR Login")
    .setStyle(ButtonStyle.Link)
    .setURL(loginUrl)
    .setEmoji("🌐");

  try {
    // If textReportOrBuffer is a Buffer, it's the old-style direct report
    if (textReportOrBuffer instanceof Buffer) {
      await user.send({
        files: [textReportOrBuffer],
        content: `Please log in to the Portal to view more details.`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(hrLoginButton),
        ],
      });
      return;
    }

    // Otherwise it's a text report with a pending image
    const sentMessage = await user.send({
      content: `${textReportOrBuffer}\n\nPlease log in to the Portal to view more details.\n\n*Generating detailed report...*`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(hrLoginButton),
      ],
    });

    // Wait for image report and update the message when it's ready
    if (imageReportPromise) {
      imageReportPromise
        .then(async (imageBuffer) => {
          if (imageBuffer) {
            await sentMessage.edit({
              content: `${textReportOrBuffer}\n\nPlease log in to the Portal to view more details.`,
              files: [imageBuffer],
              components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                  hrLoginButton
                ),
              ],
            });
          } else {
            // No image buffer returned, remove the "generating" message
            await sentMessage.edit({
              content: `${textReportOrBuffer}\n\nPlease log in to the Portal to view more details.`,
              components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                  hrLoginButton
                ),
              ],
            });
          }
        })
        .catch(async (error) => {
          console.error("Failed to generate image report:", error);
          // Remove the "generating" message when there's an error
          await sentMessage.edit({
            content: `${textReportOrBuffer}\n\nPlease log in to the Portal to view more details.`,
            components: [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                hrLoginButton
              ),
            ],
          });
        });
    }
  } catch (error) {
    console.error("Failed to send logout report:", error);
  }
};

// Outlier detection thresholds (office hours: 10 AM – 6 PM)
const LATE_THRESHOLD_MINUTES = 10 * 60 + 30; // 10:30 AM in minutes
const LATE_MIN_DAYS = 3; // must be late on at least this many days
const HOURS_DEVIATION_THRESHOLD = 0.2; // 20% above/below team median
const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Build and send a markdown-formatted weekly attendance report to the admin channel
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

  // Collect per-day attendance for every employee across the work week (Sun–Thu)
  const dayDates: Date[] = [];
  const cursor = new Date(weekStart);
  while (cursor <= weekEnd) {
    const dow = cursor.getDay();
    // Only include Sun(0)–Thu(4), skip Fri/Sat
    if (dow >= 0 && dow <= 4) {
      dayDates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Parallel: fetch each day's employees+attendance and the week's leaves
  const [dailySnapshots, leaves] = await Promise.all([
    Promise.all(dayDates.map((d) => getAllEmployeesWithAttendance(d))),
    getLeavesInDateRange(weekStart, weekEnd),
  ]);

  const workingDayDates = dayDates;

  // Build per-employee weekly data from daily snapshots
  type EmployeeDayData = {
    loginMinutes: number;
    totalHoursMs: number;
    projects: Map<string, number>;
  };

  type EmployeeWeekData = {
    name: string;
    days: Map<string, EmployeeDayData>; // ISO date string -> day data
    leaveDays: Set<string>; // ISO date strings on leave
  };

  const employeeMap = new Map<string, EmployeeWeekData>();

  // Index leaves by userId -> set of ISO date strings
  const leavesByUser = new Map<string, { dates: Set<string>; reason?: string }>();
  for (const leave of leaves) {
    const existing = leavesByUser.get(leave.userId);
    const leaveDateStrings = leave.dates
      .map((d) => new Date(d).toISOString().split("T")[0])
      .filter(
        (iso) =>
          iso >= weekStart.toISOString().split("T")[0] &&
          iso <= weekEnd.toISOString().split("T")[0]
      );

    if (existing) {
      for (const ds of leaveDateStrings) existing.dates.add(ds);
    } else {
      leavesByUser.set(leave.userId, {
        dates: new Set(leaveDateStrings),
        reason: leave.reason ?? undefined,
      });
    }
  }

  // Process daily snapshots
  for (let dayIdx = 0; dayIdx < dayDates.length; dayIdx++) {
    const dayIso = dayDates[dayIdx].toISOString().split("T")[0];
    const employees = dailySnapshots[dayIdx] as { id: string; name: string; attendance?: { login: string; workSegments: { start: string; end: string; project: string }[] } }[];

    for (const emp of employees) {
      if (!employeeMap.has(emp.id)) {
        employeeMap.set(emp.id, {
          name: emp.name ?? "Unknown",
          days: new Map(),
          leaveDays: new Set(),
        });
      }
      const empData = employeeMap.get(emp.id);
      if (!empData) continue;

      // Mark leave days
      const userLeave = leavesByUser.get(emp.id);
      if (userLeave?.dates.has(dayIso)) {
        empData.leaveDays.add(dayIso);
        continue;
      }

      // Process attendance if present
      if (emp.attendance) {
        const login = new Date(emp.attendance.login);
        const loginMinutes = login.getHours() * 60 + login.getMinutes();
        let totalMs = 0;
        const projMs = new Map<string, number>();
        const segments = Array.isArray(emp.attendance.workSegments)
          ? emp.attendance.workSegments
          : [];

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
          loginMinutes,
          totalHoursMs: totalMs,
          projects: projMs,
        });
      }
    }
  }

  // Helpers
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

  // Aggregate per-employee stats
  type EmployeeStats = {
    name: string;
    daysPresent: number;
    daysAbsent: number;
    daysOnLeave: number;
    totalHours: number;
    avgLoginMinutes: number;
    lateDays: number;
    absentDayNames: string[];
    leaveDayNames: string[];
  };

  const employeeStats: EmployeeStats[] = [];
  const allWeeklyHours: number[] = [];
  const allLoginMinutes: number[] = [];
  const projectTotals = new Map<string, { hours: number; employeeIds: Set<string> }>();
  const teamSize = employeeMap.size;
  let totalPersonDaysPresent = 0;

  for (const [userId, empData] of employeeMap) {
    const daysPresent = empData.days.size;
    const daysOnLeave = empData.leaveDays.size;
    const daysAbsent = workingDays - daysPresent - daysOnLeave;
    const totalHoursMs = [...empData.days.values()].reduce(
      (sum, d) => sum + d.totalHoursMs,
      0
    );
    const totalHours = toHours(totalHoursMs);
    const loginMinutesList = [...empData.days.values()].map((d) => d.loginMinutes);
    const avgLoginMinutes = loginMinutesList.length
      ? loginMinutesList.reduce((a, b) => a + b, 0) / loginMinutesList.length
      : 0;
    const lateDays = loginMinutesList.filter(
      (m) => m > LATE_THRESHOLD_MINUTES
    ).length;

    // Determine which working days were absent (no attendance, no leave, not holiday)
    const absentDayNames: string[] = [];
    const leaveDayNames: string[] = [];
    for (const wd of workingDayDates) {
      const iso = wd.toISOString().split("T")[0];
      if (empData.leaveDays.has(iso)) {
        leaveDayNames.push(fmtDateShort(iso));
      } else if (!empData.days.has(iso)) {
        absentDayNames.push(fmtDateShort(iso));
      }
    }

    employeeStats.push({
      name: empData.name,
      daysPresent,
      daysAbsent: Math.max(0, daysAbsent),
      daysOnLeave,
      totalHours,
      avgLoginMinutes,
      lateDays,
      absentDayNames,
      leaveDayNames,
    });

    if (daysPresent > 0) {
      allWeeklyHours.push(totalHours);
      allLoginMinutes.push(...loginMinutesList);
    }
    totalPersonDaysPresent += daysPresent;

    // Aggregate project totals
    for (const dayData of empData.days.values()) {
      for (const [proj, ms] of dayData.projects) {
        const hrs = toHours(ms);
        const rec = projectTotals.get(proj) || {
          hours: 0,
          employeeIds: new Set<string>(),
        };
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
      ? allWeeklyHours.reduce((a, b) => a + b, 0) /
        allWeeklyHours.length /
        workingDays
      : 0;
  const medianLoginMinutes = median(allLoginMinutes);

  // Classify outliers
  const absent = employeeStats
    .filter((e) => e.daysAbsent > 0)
    .sort((a, b) => b.daysAbsent - a.daysAbsent);
  const consistentlyLate = employeeStats
    .filter(
      (e) =>
        e.lateDays >= LATE_MIN_DAYS && e.avgLoginMinutes > LATE_THRESHOLD_MINUTES
    )
    .sort((a, b) => b.avgLoginMinutes - a.avgLoginMinutes);
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
        e.avgLoginMinutes <= LATE_THRESHOLD_MINUTES
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Build leave summary
  type LeaveSummaryItem = { name: string; dayNames: string[]; reason?: string };
  const leaveSummary: LeaveSummaryItem[] = [];
  for (const emp of employeeStats) {
    if (emp.daysOnLeave > 0) {
      const userLeave = [...leavesByUser.entries()].find(([uid]) => {
        const empEntry = [...employeeMap.entries()].find(
          ([id]) => id === uid
        );
        return empEntry && empEntry[1].name === emp.name;
      });
      leaveSummary.push({
        name: emp.name,
        dayNames: emp.leaveDayNames,
        reason: userLeave?.[1].reason,
      });
    }
  }
  leaveSummary.sort((a, b) => a.name.localeCompare(b.name));

  // Sort projects by hours
  const sortedProjects = [...projectTotals.entries()]
    .map(([name, rec]) => ({
      name,
      hours: rec.hours,
      employees: rec.employeeIds.size,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  // Format the report
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  const header = `**Weekly Attendance Report — ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}**`;

  const lines: string[] = [header, ""];

  // Overview
  lines.push("### Overview");
  lines.push(
    `- Team Size: ${teamSize} | Working Days: ${workingDays}`
  );
  lines.push(
    `- Attendance Rate: ${attendanceRate}% (${totalPersonDaysPresent}/${totalPersonDays} person-days)`
  );
  lines.push(
    `- Avg Daily Hours: ${fmtHours(avgDailyHours)} | Median Login Time: ${minutesToTimeStr(medianLoginMinutes)}`
  );
  lines.push("");

  // Highlights
  const hasHighlights =
    absent.length > 0 ||
    consistentlyLate.length > 0 ||
    aboveAvgHours.length > 0 ||
    belowAvgHours.length > 0 ||
    perfectAttendance.length > 0;

  if (hasHighlights) {
    lines.push("### Highlights");

    if (absent.length > 0) {
      lines.push("🔴 **Absences** (no login, no leave)");
      for (const e of absent) {
        lines.push(
          `- ${e.name}: ${e.absentDayNames.join(", ")} (${e.daysAbsent} day${e.daysAbsent > 1 ? "s" : ""})`
        );
      }
      lines.push("");
    }

    if (consistentlyLate.length > 0) {
      lines.push("⏰ **Consistently Late** (avg login after 10:30 AM on 3+ days)");
      for (const e of consistentlyLate) {
        lines.push(
          `- ${e.name}: avg login ${minutesToTimeStr(e.avgLoginMinutes)} (${e.lateDays} day${e.lateDays > 1 ? "s" : ""} late)`
        );
      }
      lines.push("");
    }

    if (aboveAvgHours.length > 0) {
      lines.push("📈 **Above Average Hours** (>20% above team median)");
      for (const e of aboveAvgHours) {
        const pct = (
          ((e.totalHours - medianWeeklyHours) / medianWeeklyHours) *
          100
        ).toFixed(0);
        lines.push(
          `- ${e.name}: ${fmtHours(e.totalHours)} total — ${pct}% above median`
        );
      }
      lines.push("");
    }

    if (belowAvgHours.length > 0) {
      lines.push("📉 **Below Average Hours** (>20% below team median)");
      for (const e of belowAvgHours) {
        const pct = (
          ((medianWeeklyHours - e.totalHours) / medianWeeklyHours) *
          100
        ).toFixed(0);
        lines.push(
          `- ${e.name}: ${fmtHours(e.totalHours)} total — ${pct}% below median`
        );
      }
      lines.push("");
    }

    if (perfectAttendance.length > 0) {
      lines.push("⭐ **Perfect Attendance** (all days, on time)");
      lines.push(`- ${perfectAttendance.map((e) => e.name).join(", ")}`);
      lines.push("");
    }
  }

  // Projects
  if (sortedProjects.length > 0) {
    lines.push("### Projects");
    for (const p of sortedProjects) {
      lines.push(
        `- ${p.name}: ${fmtHours(p.hours)} (${p.employees} employee${p.employees > 1 ? "s" : ""})`
      );
    }
    lines.push("");
  }

  // Leave
  if (leaveSummary.length > 0) {
    lines.push("### Leave");
    for (const l of leaveSummary) {
      const reason = l.reason ? ` (${l.reason})` : "";
      lines.push(`- ${l.name}: ${l.dayNames.join(", ")}${reason}`);
    }
    lines.push("");
  }

  const content = lines.join("\n");
  await (channel as TextChannel).send({ content });
}
