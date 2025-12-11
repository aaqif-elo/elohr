import { db } from ".";

// Types for wrapped statistics
export interface WrappedStats {
  year: number;
  coreStats: {
    totalDaysWorked: number;
    totalHoursWorked: number;
    totalBreakHours: number;
    earliestLogin: { time: string; date: string } | null;
    latestLogout: { time: string; date: string } | null;
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
  breakPatterns: {
    longestBreak: { durationMins: number; date: string } | null;
    mostBreaksInDay: { count: number; date: string } | null;
    averageBreakMins: number;
    totalBreaks: number;
  };
  timePersonality: {
    averageLoginTime: string | null;
    averageLogoutTime: string | null;
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

// Helper to format time from minutes since midnight
function formatTimeFromMinutes(mins: number): string {
  const hours = Math.floor(mins / 60);
  const minutes = Math.round(mins % 60);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHours = hours % 12 || 12;
  return `${displayHours}:${minutes.toString().padStart(2, "0")} ${period}`;
}

// Helper to get minutes since midnight from a Date
function getMinutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

// Helper to format date as readable string
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Determine personality type based on patterns
function determinePersonalityType(
  avgLoginMins: number | null,
  avgWorkHours: number,
  projectSwitches: number,
  totalDays: number
): string {
  if (avgLoginMins === null) return "🎭 The Mystery";

  const avgSwitchesPerDay = totalDays > 0 ? projectSwitches / totalDays : 0;

  if (avgLoginMins < 6 * 60) return "🌅 Early Bird";
  if (avgLoginMins > 18 * 60) return "🦉 Night Owl";
  if (avgWorkHours > 10) return "💪 Iron Worker";
  if (avgSwitchesPerDay > 5) return "🎭 Multitasker";
  if (avgWorkHours < 6) return "⚡ Sprinter";
  return "⚖️ Balanced Pro";
}

// Generate quirky badges based on stats
function generateBadges(
  stats: Omit<WrappedStats, "badges" | "funFacts">
): WrappedStats["badges"] {
  const badges: WrappedStats["badges"] = [];

  // Attendance badges
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

  // Hours badges
  if (stats.coreStats.totalHoursWorked >= 2000) {
    badges.push({
      id: "workaholic",
      name: "Workaholic",
      emoji: "🔥",
      description: "Logged 2000+ hours this year",
    });
  }

  // Early bird / Night owl
  if (stats.coreStats.earliestLogin) {
    const [hours] = stats.coreStats.earliestLogin.time.split(":").map(Number);
    if (hours < 6) {
      badges.push({
        id: "early_bird",
        name: "Early Bird Extreme",
        emoji: "🐦",
        description: "Started work before 6 AM",
      });
    }
  }

  // Project focused
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

  // Multitasker
  if (stats.projectInsights.projectBreakdown.length >= 10) {
    badges.push({
      id: "jack_of_all",
      name: "Jack of All Trades",
      emoji: "🃏",
      description: "Worked on 10+ different projects",
    });
  }

  // Break patterns
  if (stats.breakPatterns.averageBreakMins >= 30) {
    badges.push({
      id: "self_care",
      name: "Self-Care Champion",
      emoji: "☕",
      description: "Takes healthy breaks (30+ min avg)",
    });
  }

  // Marathon worker
  if (
    stats.timePersonality.longestWorkday &&
    stats.timePersonality.longestWorkday.hours >= 12
  ) {
    badges.push({
      id: "marathon",
      name: "Marathon Runner",
      emoji: "🏃",
      description: `Worked a 12+ hour day`,
    });
  }

  return badges;
}

// Generate fun facts
function generateFunFacts(stats: Omit<WrappedStats, "funFacts">): string[] {
  const facts: string[] = [];

  const totalHours = stats.coreStats.totalHoursWorked;
  const movieCount = Math.floor(totalHours / 2);
  facts.push(
    `🎬 Your work hours equal watching ${movieCount.toLocaleString()} movies`
  );

  const breakHours = stats.coreStats.totalBreakHours;
  const coffees = Math.floor((breakHours * 60) / 15);
  if (coffees > 0) {
    facts.push(`☕ You could've had ${coffees.toLocaleString()} coffee breaks`);
  }

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

/**
 * Get wrapped statistics for a user for a specific year
 */
export async function getWrappedStats(
  userId: string,
  year: number
): Promise<WrappedStats> {
  // Get date range for the year
  const startDate = new Date(year, 0, 1); // Jan 1
  const endDate = new Date(year, 11, 31, 23, 59, 59, 999); // Dec 31

  // Fetch all attendances for the year
  const attendances = await db.attendance.findMany({
    where: {
      userId,
      login: {
        gte: startDate,
        lte: endDate,
      },
    },
    orderBy: { login: "asc" },
  });

  // Initialize stats
  const stats: Omit<WrappedStats, "badges" | "funFacts"> = {
    year,
    coreStats: {
      totalDaysWorked: 0,
      totalHoursWorked: 0,
      totalBreakHours: 0,
      earliestLogin: null,
      latestLogout: null,
    },
    projectInsights: {
      topProject: null,
      projectBreakdown: [],
      projectSwitchCount: 0,
    },
    breakPatterns: {
      longestBreak: null,
      mostBreaksInDay: null,
      averageBreakMins: 0,
      totalBreaks: 0,
    },
    timePersonality: {
      averageLoginTime: null,
      averageLogoutTime: null,
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

  // Track unique work days
  const workDays = new Set<string>();

  // Track project time
  const projectTime: Record<string, number> = {};

  // Track login times for average
  let totalLoginMins = 0;
  let loginCount = 0;

  // Track logout times for average
  let totalLogoutMins = 0;
  let logoutCount = 0;

  // Track earliest login and latest logout
  let earliestLogin: { mins: number; date: Date } | null = null;
  let latestLogout: { mins: number; date: Date } | null = null;

  // Track breaks per day
  const breaksPerDay: Record<string, number> = {};

  // Track longest break
  let longestBreak: { durationMs: number; date: Date } | null = null;

  // Total break duration
  let totalBreakMs = 0;
  let totalBreakCount = 0;

  // Track workday durations
  const workdayDurations: Array<{ hours: number; date: Date }> = [];

  // Process each attendance record
  for (const attendance of attendances) {
    const loginDate = new Date(attendance.login);
    // Use local date string to avoid timezone issues with UTC conversion
    const dayKey = `${loginDate.getFullYear()}-${String(loginDate.getMonth() + 1).padStart(2, '0')}-${String(loginDate.getDate()).padStart(2, '0')}`;
    workDays.add(dayKey);

    // Login time tracking
    const loginMins = getMinutesSinceMidnight(loginDate);
    totalLoginMins += loginMins;
    loginCount++;

    if (!earliestLogin || loginMins < earliestLogin.mins) {
      earliestLogin = { mins: loginMins, date: loginDate };
    }

    // Logout time tracking
    if (attendance.logout) {
      const logoutDate = new Date(attendance.logout);
      const logoutMins = getMinutesSinceMidnight(logoutDate);
      totalLogoutMins += logoutMins;
      logoutCount++;

      if (!latestLogout || logoutMins > latestLogout.mins) {
        latestLogout = { mins: logoutMins, date: logoutDate };
      }
    }

    // Total work time
    if (attendance.totalWork) {
      const workHours = attendance.totalWork / (1000 * 60 * 60);
      workdayDurations.push({ hours: workHours, date: loginDate });
    }

    // Process work segments for project time
    const workSegments = attendance.workSegments as Array<{
      project: string;
      length_ms?: number;
    }>;

    let prevProject: string | null = null;
    for (const segment of workSegments) {
      if (segment.length_ms) {
        projectTime[segment.project] =
          (projectTime[segment.project] || 0) + segment.length_ms;
      }

      // Count project switches
      if (prevProject && prevProject !== segment.project) {
        stats.projectInsights.projectSwitchCount++;
      }
      prevProject = segment.project;
    }

    // Process breaks
    const breaks = attendance.breaks as Array<{
      start: Date;
      end?: Date;
      length_ms?: number;
    }>;

    breaksPerDay[dayKey] = (breaksPerDay[dayKey] || 0) + breaks.length;
    totalBreakCount += breaks.length;

    for (const brk of breaks) {
      if (brk.length_ms) {
        totalBreakMs += brk.length_ms;

        if (!longestBreak || brk.length_ms > longestBreak.durationMs) {
          longestBreak = {
            durationMs: brk.length_ms,
            date: new Date(brk.start),
          };
        }
      }
    }
  }

  // Calculate core stats - use attendance count as each record represents one work day
  stats.coreStats.totalDaysWorked = attendances.length;
  stats.coreStats.totalHoursWorked = Math.round(
    attendances.reduce((sum, a) => sum + (a.totalWork || 0), 0) /
    (1000 * 60 * 60)
  );
  stats.coreStats.totalBreakHours = Math.round(totalBreakMs / (1000 * 60 * 60));

  if (earliestLogin) {
    stats.coreStats.earliestLogin = {
      time: formatTimeFromMinutes(earliestLogin.mins),
      date: formatDate(earliestLogin.date),
    };
  }

  if (latestLogout) {
    stats.coreStats.latestLogout = {
      time: formatTimeFromMinutes(latestLogout.mins),
      date: formatDate(latestLogout.date),
    };
  }

  // Calculate project insights
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

  // Calculate break patterns
  stats.breakPatterns.totalBreaks = totalBreakCount;
  stats.breakPatterns.averageBreakMins =
    totalBreakCount > 0
      ? Math.round(totalBreakMs / totalBreakCount / (1000 * 60))
      : 0;

  if (longestBreak) {
    stats.breakPatterns.longestBreak = {
      durationMins: Math.round(longestBreak.durationMs / (1000 * 60)),
      date: formatDate(longestBreak.date),
    };
  }

  const mostBreaksEntry = Object.entries(breaksPerDay).sort(
    (a, b) => b[1] - a[1]
  )[0];
  if (mostBreaksEntry) {
    stats.breakPatterns.mostBreaksInDay = {
      count: mostBreaksEntry[1],
      date: formatDate(new Date(mostBreaksEntry[0])),
    };
  }

  // Calculate time personality
  if (loginCount > 0) {
    stats.timePersonality.averageLoginTime = formatTimeFromMinutes(
      totalLoginMins / loginCount
    );
  }

  if (logoutCount > 0) {
    stats.timePersonality.averageLogoutTime = formatTimeFromMinutes(
      totalLogoutMins / logoutCount
    );
  }

  // Find longest and shortest workdays
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

  // Determine personality type
  stats.timePersonality.personalityType = determinePersonalityType(
    loginCount > 0 ? totalLoginMins / loginCount : null,
    stats.coreStats.totalHoursWorked /
    Math.max(1, stats.coreStats.totalDaysWorked),
    stats.projectInsights.projectSwitchCount,
    stats.coreStats.totalDaysWorked
  );

  // Generate badges and fun facts
  const badges = generateBadges(stats);
  const funFacts = generateFunFacts({ ...stats, badges });

  return {
    ...stats,
    badges,
    funFacts,
  };
}
