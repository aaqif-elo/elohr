import { db } from ".";

export interface WrappedStats {
  year: number;
  coreStats: {
    totalDaysWorked: number;
    totalHoursWorked: number;
    earliestWorkStart: { time: string; date: string } | null;
    latestWorkEnd: { time: string; date: string } | null;
  };
  projectInsights: {
    topProject: { name: string; hours: number } | null;
    projectBreakdown: Array<{
      name: string;
      hours: number;
      percentage: number;
    }>;
    projectSwitchCount: number;
  };
  timePersonality: {
    averageStartTime: string | null;
    averageEndTime: string | null;
    longestWorkday: { hours: number; date: string } | null;
    shortestWorkday: { hours: number; date: string } | null;
    personalityType: string;
  };
  badges: Array<{
    id: string;
    name: string;
    emoji: string;
    description: string;
  }>;
  funFacts: string[];
}

function formatTimeFromMinutes(mins: number): string {
  const hours = Math.floor(mins / 60);
  const minutes = Math.round(mins % 60);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;
}

function getMinutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function determinePersonalityType(
  avgStartMins: number | null,
  avgWorkHours: number,
  projectSwitches: number,
  totalDays: number
): string {
  if (avgStartMins === null) return "🎭 The Mystery";

  const avgSwitchesPerDay = totalDays > 0 ? projectSwitches / totalDays : 0;

  if (avgStartMins < 6 * 60) return "🌅 Early Bird";
  if (avgStartMins > 18 * 60) return "🦉 Night Owl";
  if (avgWorkHours > 10) return "💪 Iron Worker";
  if (avgSwitchesPerDay > 5) return "🎭 Multitasker";
  if (avgWorkHours < 6) return "⚡ Sprinter";
  return "⚖️ Balanced Pro";
}

function generateBadges(
  stats: Omit<WrappedStats, "badges" | "funFacts">
): WrappedStats["badges"] {
  const badges: WrappedStats["badges"] = [];

  if (stats.coreStats.totalDaysWorked >= 250) {
    badges.push({
      id: "attendance_champion",
      name: "Attendance Champion",
      emoji: "🏆",
      description: "Worked 250+ days this year",
    });
  } else if (stats.coreStats.totalDaysWorked >= 200) {
    badges.push({
      id: "dedicated",
      name: "The Dedicated",
      emoji: "🎯",
      description: "Worked 200+ days this year",
    });
  }

  if (stats.coreStats.totalHoursWorked >= 2000) {
    badges.push({
      id: "workaholic",
      name: "Workaholic",
      emoji: "🔥",
      description: "Logged 2000+ hours this year",
    });
  }

  if (stats.coreStats.earliestWorkStart) {
    const [hours] = stats.coreStats.earliestWorkStart.time.split(":").map(Number);
    if (hours < 6) {
      badges.push({
        id: "early_bird",
        name: "Early Bird Extreme",
        emoji: "🐦",
        description: "Started work before 6 AM",
      });
    }
  }

  if (stats.projectInsights.topProject) {
    const topProjectPercentage =
      stats.projectInsights.projectBreakdown[0]?.percentage || 0;
    if (topProjectPercentage >= 50) {
      badges.push({
        id: "laser_focused",
        name: "Laser Focused",
        emoji: "🎯",
        description: `Spent 50%+ time on ${stats.projectInsights.topProject.name}`,
      });
    }
  }

  if (stats.projectInsights.projectBreakdown.length >= 10) {
    badges.push({
      id: "jack_of_all",
      name: "Jack of All Trades",
      emoji: "🃏",
      description: "Worked on 10+ different projects",
    });
  }

  if (
    stats.timePersonality.longestWorkday &&
    stats.timePersonality.longestWorkday.hours >= 12
  ) {
    badges.push({
      id: "marathon",
      name: "Marathon Runner",
      emoji: "🏃",
      description: "Worked a 12+ hour day",
    });
  }

  return badges;
}

function generateFunFacts(stats: Omit<WrappedStats, "funFacts">): string[] {
  const facts: string[] = [];

  const totalHours = stats.coreStats.totalHoursWorked;
  const movieCount = Math.floor(totalHours / 2);
  facts.push(
    `🎬 Your work hours equal watching ${movieCount.toLocaleString()} movies`
  );

  if (stats.projectInsights.projectSwitchCount > 0) {
    facts.push(
      `🔄 You switched projects ${stats.projectInsights.projectSwitchCount.toLocaleString()} times`
    );
  }

  const daysWorked = stats.coreStats.totalDaysWorked;
  const percentOfYear = Math.round((daysWorked / 365) * 100);
  facts.push(`📅 You worked ${percentOfYear}% of the days in ${stats.year}`);

  return facts;
}

export async function getWrappedStats(
  userId: string,
  year: number
): Promise<WrappedStats> {
  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31, 23, 59, 59, 999);

  const attendances = await db.attendance.findMany({
    where: {
      userId,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: "asc" },
  });

  const stats: Omit<WrappedStats, "badges" | "funFacts"> = {
    year,
    coreStats: {
      totalDaysWorked: 0,
      totalHoursWorked: 0,
      earliestWorkStart: null,
      latestWorkEnd: null,
    },
    projectInsights: {
      topProject: null,
      projectBreakdown: [],
      projectSwitchCount: 0,
    },
    timePersonality: {
      averageStartTime: null,
      averageEndTime: null,
      longestWorkday: null,
      shortestWorkday: null,
      personalityType: "🎭 The Mystery",
    },
  };

  if (attendances.length === 0) {
    return {
      ...stats,
      badges: [],
      funFacts: ["📭 No attendance records found for this year"],
    };
  }

  const projectTime: Record<string, number> = {};
  let totalStartMins = 0;
  let startCount = 0;
  let totalEndMins = 0;
  let endCount = 0;
  let earliestStart: { mins: number; date: Date } | null = null;
  let latestEnd: { mins: number; date: Date } | null = null;
  const workdayDurations: Array<{ hours: number; date: Date }> = [];

  for (const attendance of attendances) {
    const attendanceDate = new Date(attendance.date);

    const segments = attendance.workSegments as Array<{
      start: Date;
      end?: Date | null;
      project: string;
      length_ms?: number | null;
    }>;

    if (segments.length === 0) continue;

    // First segment start = "start time" for this day
    const firstSeg = segments[0];
    const firstStart = new Date(firstSeg.start);
    const startMins = getMinutesSinceMidnight(firstStart);
    totalStartMins += startMins;
    startCount++;

    if (!earliestStart || startMins < earliestStart.mins) {
      earliestStart = { mins: startMins, date: firstStart };
    }

    // Last segment end = "end time" for this day
    const lastSeg = segments[segments.length - 1];
    if (lastSeg.end) {
      const lastEnd = new Date(lastSeg.end);
      const endMins = getMinutesSinceMidnight(lastEnd);
      totalEndMins += endMins;
      endCount++;

      if (!latestEnd || endMins > latestEnd.mins) {
        latestEnd = { mins: endMins, date: lastEnd };
      }
    }

    // Total work time
    if (attendance.totalWork) {
      const workHours = attendance.totalWork / (1000 * 60 * 60);
      workdayDurations.push({ hours: workHours, date: attendanceDate });
    }

    // Project time and switches
    let prevProject: string | null = null;
    for (const segment of segments) {
      if (segment.length_ms) {
        projectTime[segment.project] =
          (projectTime[segment.project] || 0) + segment.length_ms;
      }
      if (prevProject && prevProject !== segment.project) {
        stats.projectInsights.projectSwitchCount++;
      }
      prevProject = segment.project;
    }
  }

  stats.coreStats.totalDaysWorked = attendances.length;
  stats.coreStats.totalHoursWorked = Math.round(
    attendances.reduce((sum, a) => sum + (a.totalWork || 0), 0) /
    (1000 * 60 * 60)
  );

  if (earliestStart) {
    stats.coreStats.earliestWorkStart = {
      time: formatTimeFromMinutes(earliestStart.mins),
      date: formatDate(earliestStart.date),
    };
  }

  if (latestEnd) {
    stats.coreStats.latestWorkEnd = {
      time: formatTimeFromMinutes(latestEnd.mins),
      date: formatDate(latestEnd.date),
    };
  }

  const totalProjectTime = Object.values(projectTime).reduce(
    (sum, ms) => sum + ms,
    0
  );

  const projectBreakdown = Object.entries(projectTime)
    .map(([name, ms]) => ({
      name,
      hours: Math.round(ms / (1000 * 60 * 60)),
      percentage: Math.round((ms / totalProjectTime) * 100),
    }))
    .sort((a, b) => b.hours - a.hours);

  stats.projectInsights.projectBreakdown = projectBreakdown;
  if (projectBreakdown.length > 0) {
    stats.projectInsights.topProject = {
      name: projectBreakdown[0].name,
      hours: projectBreakdown[0].hours,
    };
  }

  if (startCount > 0) {
    stats.timePersonality.averageStartTime = formatTimeFromMinutes(
      totalStartMins / startCount
    );
  }

  if (endCount > 0) {
    stats.timePersonality.averageEndTime = formatTimeFromMinutes(
      totalEndMins / endCount
    );
  }

  if (workdayDurations.length > 0) {
    const sorted = [...workdayDurations].sort((a, b) => b.hours - a.hours);
    stats.timePersonality.longestWorkday = {
      hours: Math.round(sorted[0].hours * 10) / 10,
      date: formatDate(sorted[0].date),
    };
    stats.timePersonality.shortestWorkday = {
      hours: Math.round(sorted[sorted.length - 1].hours * 10) / 10,
      date: formatDate(sorted[sorted.length - 1].date),
    };
  }

  stats.timePersonality.personalityType = determinePersonalityType(
    startCount > 0 ? totalStartMins / startCount : null,
    stats.coreStats.totalHoursWorked / Math.max(1, stats.coreStats.totalDaysWorked),
    stats.projectInsights.projectSwitchCount,
    stats.coreStats.totalDaysWorked
  );

  const badges = generateBadges(stats);
  const funFacts = generateFunFacts({ ...stats, badges });

  return { ...stats, badges, funFacts };
}
