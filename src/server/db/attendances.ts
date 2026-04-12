import type { Attendance } from "@prisma/client";
import { db, ONE_DAY_IN_MS } from ".";
import { getStartOfDay, getEndOfDay } from "./util";
import EventEmitter from "events";
import { generateJWTFromUserId } from "../api/routers";
import {
  generateTextAttendanceReport,
  queueAttendanceStatsImage,
} from "../services/discord/utils";

// Add this near the top after imports
// Reasonable cap for open-ended segments to avoid corrupt data skewing results
const DEFAULT_MAX_OPEN_SEGMENT_HOURS = 16;
console.log("Loading attendances.ts module");

// Global declaration
declare global {
  var _attendanceEventsGlobal: AttendanceEventEmitter | undefined;
}

interface AttendanceEvents {
  attendanceUpdated: (attendance: Attendance) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
class AttendanceEventEmitter extends EventEmitter {
  public toIterable<K extends keyof AttendanceEvents>(
    event: K,
    opts: { signal?: AbortSignal },
  ): AsyncIterable<[Parameters<AttendanceEvents[K]>[0]]> {
    const events: [Parameters<AttendanceEvents[K]>[0]][] = [];
    const queue: ((
      value: IteratorResult<[Parameters<AttendanceEvents[K]>[0]]>,
    ) => void)[] = [];

    // Create the event listener that will be attached
    const listener = (data: Parameters<AttendanceEvents[K]>[0]) => {
      const resolve = queue.shift();
      if (resolve) {
        resolve({ value: [data], done: false });
      } else {
        events.push([data]);
      }
    };

    // Add the listener
    this.on(event, listener);

    // Explicit cleanup function to ensure listener removal
    const cleanup = () => {
      this.removeListener(event, listener);
      console.log(
        `Removed listener for ${String(event)}, remaining: ${this.listenerCount(
          event,
        )}`,
      );
    };

    // Add the cleanup to the abort signal
    if (opts.signal) {
      opts.signal.addEventListener("abort", cleanup, { once: true });
    }

    return {
      [Symbol.asyncIterator]() {
        return {
          next: async (): Promise<
            IteratorResult<[Parameters<AttendanceEvents[K]>[0]]>
          > => {
            if (events.length > 0) {
              const event = events.shift();
              if (event) return { value: event, done: false };
            }

            if (opts.signal?.aborted) {
              cleanup(); // Ensure cleanup happens if signal is aborted
              return { value: undefined, done: true };
            }

            return new Promise((resolve) => {
              queue.push(resolve);

              if (opts.signal) {
                const abortHandler = () => {
                  const index = queue.indexOf(resolve);
                  if (index >= 0) queue.splice(index, 1);
                  resolve({ value: undefined, done: true });
                  // We don't call cleanup here as it's already called by the abort event listener above
                };

                opts.signal.addEventListener("abort", abortHandler, {
                  once: true,
                });
              }
            });
          },
          // Add the return method to handle early terminations (like breaks in for-await loops)
          return: async (): Promise<
            IteratorResult<[Parameters<AttendanceEvents[K]>[0]]>
          > => {
            cleanup(); // Ensure cleanup happens for early termination
            return { value: undefined, done: true };
          },
        };
      },
    };
  }
}

// Add this near your AttendanceEventEmitter class

// Map to track active subscriptions by userId
export const activeSubscriptions = new Map<string, AbortController>();

// Function to clean up an existing subscription
export function cleanupExistingSubscription(userId: string): boolean {
  const controller = activeSubscriptions.get(userId);
  if (controller) {
    console.log(`Cleaning up existing subscription for user ${userId}`);
    controller.abort();
    activeSubscriptions.delete(userId);
    return true;
  }
  return false;
}

// Function to register a new subscription
export function registerSubscription(
  userId: string,
  controller: AbortController,
): void {
  activeSubscriptions.set(userId, controller);
  console.log(`Registered subscription for user ${userId}`);
  console.log(`Total active subscriptions: ${activeSubscriptions.size}`);
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
declare interface AttendanceEventEmitter {
  on<K extends keyof AttendanceEvents>(
    event: K,
    listener: AttendanceEvents[K],
  ): this;
  off<K extends keyof AttendanceEvents>(
    event: K,
    listener: AttendanceEvents[K],
  ): this;
  once<K extends keyof AttendanceEvents>(
    event: K,
    listener: AttendanceEvents[K],
  ): this;
  emit<K extends keyof AttendanceEvents>(
    event: K,
    ...args: Parameters<AttendanceEvents[K]>
  ): boolean;
}

// Then create your event emitter
export const attendanceEvents =
  global._attendanceEventsGlobal || new AttendanceEventEmitter();

if (!global._attendanceEventsGlobal) {
  console.log("Creating new AttendanceEventEmitter instance");
} else {
  console.log("Reusing existing AttendanceEventEmitter instance");
}

global._attendanceEventsGlobal = attendanceEvents;
attendanceEvents.setMaxListeners(0);

console.log(
  "Initializing attendanceEvents singleton instance",
  attendanceEvents,
);

// --- Region: Locale-specific working days (Bangladesh) ---
// In Bangladesh, the weekend is Friday (5) and Saturday (6).
// Working days are Sunday (0) through Thursday (4).
const BD_WEEKEND_DAYS = new Set<number>([5, 6]);
const isWeekendBD = (dateOrDow: Date | number): boolean => {
  const dow = typeof dateOrDow === "number" ? dateOrDow : dateOrDow.getDay();
  return BD_WEEKEND_DAYS.has(dow);
};

/**
 * Returns the start (Sunday 00:00:00.000) and end (Thursday 23:59:59.999)
 * of the Bangladesh work week containing the given date.
 * BD work week: Sunday (0) through Thursday (4). Weekends: Friday (5), Saturday (6).
 */
export function getWeekDateRange(date: Date): { start: Date; end: Date } {
  const dow = date.getDay(); // 0=Sun, 1=Mon, ..., 4=Thu, 5=Fri, 6=Sat
  const daysSinceSunday = dow <= 4 ? dow : dow === 5 ? 5 : 6;

  const sunday = new Date(date);
  sunday.setDate(date.getDate() - daysSinceSunday);

  const thursday = new Date(sunday);
  thursday.setDate(sunday.getDate() + 4);

  return {
    start: getStartOfDay(sunday),
    end: getEndOfDay(thursday),
  };
}

/**
 * Returns today's start (00:00:00.000) and end (23:59:59.999) timestamps.
 */
export function getStartAndEndOfDay(now: Date): { start: Date; end: Date } {
  // Start of today
  const start = getStartOfDay(now);

  // End of today
  const end = getEndOfDay(now);

  return { start, end };
}

function getDateRangePayload(date: Date) {
  const { start, end } = getStartAndEndOfDay(date);
  return {
    gte: start,
    lte: end,
  };
}

export const getAttendanceForUser = async (
  userId: string,
  date = new Date(),
) => {
  const attendance = await db.attendance.findFirst({
    where: {
      userId,
      login: getDateRangePayload(date),
    },
  });
  return attendance;
};

/**
 * Get all attendance records for a user within a date range
 * @param userId The user's ID
 * @param startDate The start of the date range
 * @param endDate The end of the date range
 * @returns Array of attendance records within the date range
 */
export const getAttendancesInDateRange = async (
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<Attendance[]> => {
  return db.attendance.findMany({
    where: {
      userId,
      login: {
        gte: startDate,
        lte: endDate,
      },
    },
  });
};

/**
 * Count working days between two dates (excluding weekends and holidays)
 * @param startDate The start date
 * @param endDate The end date
 * @param holidays Array of holiday dates to exclude
 * @returns Number of working days
 */
export const countWorkingDays = (
  startDate: Date,
  endDate: Date,
  holidays: Date[] = [],
): number => {
  let count = 0;
  const currentDate = new Date(startDate);

  // Create a set of holiday dates for faster lookup
  const holidaySet = new Set(
    holidays.map((date) => new Date(date).toISOString().split("T")[0]),
  );

  // Loop through each day in the range
  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    const dateString = currentDate.toISOString().split("T")[0];

    // Skip Bangladesh weekends (Fri=5, Sat=6) and holidays
    if (!isWeekendBD(dayOfWeek) && !holidaySet.has(dateString)) {
      count++;
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return count;
};

/**
 * Get the logged-in attendance for a user
 * @param userId The user's ID
 * @returns The attendance record if found, otherwise null
 */
const getLoggedInAttendance = async (userId: string, date = new Date()) => {
  const attendance = await db.attendance.findFirst({
    where: {
      userId,
      login: getDateRangePayload(date),
      OR: [
        {
          logout: { isSet: false },
        },
        {
          logout: null,
        },
      ],
    },
  });
  return attendance;
};

/**
 * Check if a user can take a break
 * @param userId The user's ID
 * @param day The date to check (default is today)
 * @returns True if the user can take a break, or the start time of the last break
 */
export const canBreak = async (userId: string, day: Date | null = null) => {
  const breakFound = await db.attendance.findFirst({
    where: {
      userId,
      login: getDateRangePayload(day || new Date()),
      OR: [
        {
          logout: { isSet: false },
        },
        {
          logout: null,
        },
      ],
    },
    select: {
      breaks: true,
    },
  });

  if (breakFound === null) {
    return true;
  }

  const lastBreak = breakFound.breaks[breakFound.breaks.length - 1];
  if (!lastBreak) {
    return true;
  }
  return lastBreak.end === null ? lastBreak.start : true;
};

/**
 * Start a break for a user
 * @param userId The user's ID
 * @param reason The reason for the break (default is empty string)
 * @returns The start time of the break
 */
export const breakStart = async (userId: string, reason: string = "") => {
  const breakStartTime = new Date();
  const attendance = await getLoggedInAttendance(userId);

  if (!attendance) {
    return null;
  }

  // End the latest work segment if still open
  if (attendance.workSegments.length > 0) {
    const lastSeg = attendance.workSegments[attendance.workSegments.length - 1];
    if (!lastSeg.end) {
      lastSeg.end = breakStartTime;
      lastSeg.length_ms = breakStartTime.getTime() - lastSeg.start.getTime();
    }
  }

  // Now proceed with your existing logic for break:
  attendance.breaks.push({
    start: breakStartTime,
    reason,
    end: null,
    length_ms: null,
  });

  await db.attendance.update({
    where: {
      id: attendance.id,
    },
    data: {
      breaks: attendance.breaks,
      workSegments: attendance.workSegments,
    },
  });

  attendanceEvents.emit("attendanceUpdated", attendance);
  return breakStartTime;
};

/**
 * End a break for a user
 * @param userId The user's ID
 * @param project The project the user is working on (optional)
 * @returns Null if no break is found, otherwise a string announcing the end of the break
 */
export const breakEnd = async (userId: string, project?: string) => {
  const attendance = await getLoggedInAttendance(userId);

  if (!attendance) {
    return null;
  }

  const lastBreak = attendance.breaks[attendance.breaks.length - 1];
  if (!lastBreak || lastBreak.end) {
    return null;
  }

  lastBreak.end = new Date();
  lastBreak.length_ms = lastBreak.end.getTime() - lastBreak.start.getTime();

  // If a project is provided, add it to the work segments
  if (project) {
    attendance.workSegments.push({
      start: lastBreak.end,
      end: null,
      project,
      length_ms: null,
    });
  }

  // Update the attendance record in the database
  await db.attendance.update({
    where: {
      id: attendance.id,
    },
    data: {
      breaks: attendance.breaks,
      workSegments: attendance.workSegments,
    },
  });

  let prefix: string;
  if (!lastBreak.reason) {
    prefix = "Break";
  } else {
    prefix = lastBreak.reason + " break";
  }
  attendanceEvents.emit("attendanceUpdated", attendance);
  return `${prefix} for ${Math.round(
    lastBreak.length_ms / (1000 * 60),
  )} minutes ended at ${lastBreak.end.toLocaleTimeString()}`;
};

/**
 * Get today's login time for a user
 * @param userId
 * @returns A date object representing the login time, or null if not found
 */
export const getLoginTime = async (userId: string) => {
  const attendance = await db.attendance.findFirst({
    where: {
      userId,
      login: getDateRangePayload(new Date()),
    },
  });
  return attendance ? attendance.login : null;
};

/**
 * Log out a user
 * @param userId
 * @returns An object containing the logout time and report, or null if not found
 */
export const logout = async (userId: string) => {
  let logoutTime = new Date();
  const attendance = await getLoggedInAttendance(userId);
  if (!attendance) {
    return null;
  }

  if ((await canBreak(userId)) !== true) {
    // Remove the last break if it was not ended
    const lastBreak = attendance.breaks[attendance.breaks.length - 1];
    if (lastBreak && !lastBreak.end) {
      attendance.breaks.pop();
      // Set the logout time to be the start of the last break
      logoutTime = lastBreak.start;
    }
  }

  // Close the final work segment if still open
  if (attendance.workSegments.length > 0) {
    const lastSeg = attendance.workSegments[attendance.workSegments.length - 1];
    if (!lastSeg.end) {
      lastSeg.end = logoutTime;
      lastSeg.length_ms = logoutTime.getTime() - lastSeg.start.getTime();
    }
  }

  let totalBreak = 0;
  attendance.breaks.forEach((brek) => {
    totalBreak += brek.length_ms || 0;
  });

  const totalTime = logoutTime.getTime() - attendance.login.getTime();

  const totalWorkTime = totalTime - totalBreak;

  // Update the attendance doc
  attendance.logout = logoutTime;
  attendance.totalBreak = totalBreak;
  attendance.totalWork = totalWorkTime;
  attendance.totalTime = totalTime;

  const updatedAttendance = await db.attendance.update({
    where: {
      id: attendance.id,
    },
    data: {
      logout: attendance.logout,
      workSegments: attendance.workSegments,
      breaks: attendance.breaks,
      totalBreak: attendance.totalBreak,
      totalWork: attendance.totalWork,
      totalTime: attendance.totalTime,
    },
  });

  attendanceEvents.emit("attendanceUpdated", updatedAttendance);

  // Return the updated attendance data with a text report
  return {
    attendance: updatedAttendance,
    time: logoutTime,
    textReport: generateTextAttendanceReport(updatedAttendance),
  };
};

/**
 * Check if the user can break or resume
 * @param userId The user's ID
 * @returns An error message if the user cannot break or resume, otherwise true
 */
export const canBreakOrResume = async (userId: string) => {
  const attendance = await getLoggedInAttendance(userId);
  if (!attendance) {
    return "❌ You are not logged in.";
  }

  if (attendance.logout) {
    return "❌ You have already logged out.";
  }

  return true;
};

/**
 * Log in a user
 * @param userId The user's ID
 * @param project The project the user is working on
 * @returns The attendance record if successful, otherwise a string error message
 */
export const login = async (userId: string, project: string) => {
  const attendance = await getLoggedInAttendance(userId);
  if (attendance) {
    return "❌ You are already logged in.";
  }

  const loginTime = new Date();
  const newAttendance = await db.attendance.create({
    data: {
      userId,
      login: loginTime,
      workSegments: [
        {
          start: loginTime,
          end: null,
          project,
          length_ms: null,
        },
      ],
      breaks: [],
    },
  });

  attendanceEvents.emit("attendanceUpdated", newAttendance);
  return newAttendance;
};

/**
 * Check if the user is on a break
 * @param userId The user's ID
 * @returns A boolean indicating if the user is on a break
 */
export const isOnBreak = async (userId: string) => {
  const attendance = await getLoggedInAttendance(userId);
  if (!attendance) {
    return false;
  }

  const lastBreak = attendance.breaks[attendance.breaks.length - 1];
  return lastBreak && !lastBreak.end;
};

/**
 * Switch the current project for a user
 * @param userId The user's ID
 * @param project The project name
 * @returns A boolean indicating if the project switch was successful
 */
export const switchProject = async (userId: string, project: string) => {
  const attendance = await getLoggedInAttendance(userId);
  if (!attendance) {
    return false;
  }

  // End the latest work segment if still open
  if (attendance.workSegments.length > 0) {
    const lastSeg = attendance.workSegments[attendance.workSegments.length - 1];
    if (!lastSeg.end) {
      lastSeg.end = new Date();
      lastSeg.length_ms = lastSeg.end.getTime() - lastSeg.start.getTime();
    }
  }

  // Add a new work segment with the new project
  attendance.workSegments.push({
    start: new Date(),
    end: null,
    project,
    length_ms: null,
  });

  await db.attendance.update({
    where: {
      id: attendance.id,
    },
    data: {
      workSegments: attendance.workSegments,
    },
  });
  attendanceEvents.emit("attendanceUpdated", attendance);
  return true;
};

/**
 * Get all users who are currently logged in
 * @returns An array of user IDs
 */
export const getLoggedInUsers = async () => {
  const attendances = await db.attendance.findMany({
    where: {
      login: getDateRangePayload(new Date()),
      OR: [
        {
          logout: { isSet: false },
        },
        {
          logout: null,
        },
      ],
    },
  });
  return attendances.map((attendance) => attendance.userId);
};

/**
 * Generate an attendance image report for a user
 * @param userId The user's ID
 * @param date Optional Date for which to generate the report.
 * @returns A promise for the image generation
 */
export const generateAttendanceImageReport = async (
  userId: string,
  date?: Date,
) => {
  const jwtWithUser = await generateJWTFromUserId(userId);
  if (!jwtWithUser?.jwt) {
    return null;
  }

  // Pass date parameter to queueAttendanceStatsImage
  return queueAttendanceStatsImage(
    jwtWithUser.jwt,
    jwtWithUser.userWithAttendance.user.isAdmin,
    date,
  );
};

// ---- Weekday Availability (Smart defaults, minimal params) ----

interface WeekdayHeatmapSlot {
  slotIndex: number; // 0..slotsPerDay-1
  startMinutes: number; // minutes since 00:00
  endMinutes: number; // minutes since 00:00
  presentWeight: number; // weighted presence sum
  sampleWeight: number; // weighted sample sum
  confidence: number; // presentWeight / sampleWeight (0..1)
}

/**
 * Build a weekday-only heatmap aggregated across Sun–Thu (Bangladesh working days).
 * - Excludes weekends (Fri–Sat in BD)
 * - Excludes active holidays (original or overridden date)
 * - Uses exponential recency weighting (half-life)
 * - Default slot = 30 minutes
 */
export async function getWeekdayAvailabilityHeatmap(
  userId: string,
  days = 30,
  opts?: {
    slotMinutes?: number;
    recencyHalfLifeDays?: number;
    maxOpenSegmentHours?: number;
  },
): Promise<{
  heatmap: WeekdayHeatmapSlot[];
  meta: {
    daysRequested: number;
    daysIncluded: number;
    slotMinutes: number;
    recencyHalfLifeDays: number;
  };
}> {
  const slotMinutes = opts?.slotMinutes ?? 30;
  const recencyHalfLifeDays = opts?.recencyHalfLifeDays ?? 30;
  const maxOpenSegmentHours =
    opts?.maxOpenSegmentHours ?? DEFAULT_MAX_OPEN_SEGMENT_HOURS;

  if (days <= 0) {
    return {
      heatmap: [],
      meta: {
        daysRequested: days,
        daysIncluded: 0,
        slotMinutes,
        recencyHalfLifeDays,
      },
    };
  }

  const endOfToday = getEndOfDay(new Date());
  const startDate = new Date(endOfToday);
  startDate.setDate(startDate.getDate() - (days - 1));
  const startOfStart = getStartOfDay(startDate);

  // Pull holidays in range
  const holidays = await db.holiday.findMany({
    where: {
      isActive: true,
      OR: [
        { originalDate: { gte: startOfStart, lte: endOfToday } },
        { overridenDate: { gte: startOfStart, lte: endOfToday } },
      ],
    },
    select: { originalDate: true, overridenDate: true },
  });
  const iso = (d: Date) => d.toISOString().split("T")[0];
  const holidaySet = new Set<string>();
  for (const h of holidays)
    holidaySet.add(iso(h.overridenDate ?? h.originalDate));

  // Fetch attendances (extend 1 day back to catch segments crossing midnight)
  const attendances = await db.attendance.findMany({
    where: {
      userId,
      login: {
        gte: new Date(startOfStart.getTime() - ONE_DAY_IN_MS),
        lte: endOfToday,
      },
    },
  });

  const slotsPerDay = Math.floor((24 * 60) / slotMinutes);
  const presentWeights: number[] = Array(slotsPerDay).fill(0);
  const sampleWeights: number[] = Array(slotsPerDay).fill(0);

  // Build list of included weekdays with weights
  const includedDays: { start: Date; end: Date; weight: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(endOfToday);
    d.setDate(d.getDate() - i);
    const dayStart = getStartOfDay(d);
    const dayEnd = getEndOfDay(d);
    const dow = dayStart.getDay();
    if (isWeekendBD(dow)) continue; // skip Fri/Sat (BD weekend)
    if (holidaySet.has(iso(dayStart))) continue; // skip holidays

    const ageDays = Math.floor(
      (endOfToday.getTime() - dayEnd.getTime()) / ONE_DAY_IN_MS,
    );
    const weight = Math.pow(0.5, ageDays / recencyHalfLifeDays);
    includedDays.push({ start: dayStart, end: dayEnd, weight });
  }

  // For each included weekday, mark samples and presence by checking overlapping workSegments
  for (const day of includedDays) {
    // Precompute intervals overlapping this day
    const intervals: Array<{ start: Date; end: Date }> = [];
    for (const a of attendances) {
      for (const seg of a.workSegments) {
        // Normalize potentially corrupted segments
        const attendanceEnd = a.logout ?? new Date();

        let segStart = new Date(seg.start);
        let segEnd = new Date(seg.end ?? attendanceEnd);

        // If segment starts before attendance login, clamp to login
        if (a.login && segStart < a.login) segStart = new Date(a.login);
        // If segment ends after attendance end, clamp to end
        if (segEnd > attendanceEnd) segEnd = attendanceEnd;

        // Cap open-ended segments to avoid extremely long running intervals
        if (!seg.end) {
          const cap = new Date(
            segStart.getTime() + maxOpenSegmentHours * 60 * 60 * 1000,
          );
          if (segEnd > cap) segEnd = cap;
        }

        // Skip invalid segments
        if (isNaN(segStart.getTime()) || isNaN(segEnd.getTime())) continue;
        if (segEnd <= segStart) continue;

        // Overlap with this day?
        if (segStart <= day.end && segEnd >= day.start) {
          const s = new Date(Math.max(segStart.getTime(), day.start.getTime()));
          const e = new Date(Math.min(segEnd.getTime(), day.end.getTime()));
          if (e > s) {
            intervals.push({ start: s, end: e });
          }
        }
      }
    }

    for (let s = 0; s < slotsPerDay; s++) {
      const slotStart = new Date(
        day.start.getTime() + s * slotMinutes * 60_000,
      );
      const slotEnd = new Date(slotStart.getTime() + slotMinutes * 60_000);

      // Count sample for every slot on included days
      sampleWeights[s] += day.weight;

      // Present if any interval overlaps this slot
      let present = false;
      for (const iv of intervals) {
        if (slotStart < iv.end && slotEnd > iv.start) {
          present = true;
          break;
        }
      }
      if (present) presentWeights[s] += day.weight;
    }
  }

  const heatmap: WeekdayHeatmapSlot[] = [];
  for (let s = 0; s < slotsPerDay; s++) {
    const startMinutes = s * slotMinutes;
    const endMinutes = startMinutes + slotMinutes;
    const present = presentWeights[s];
    const sample = sampleWeights[s];
    const confidence = sample > 0 ? present / sample : 0;
    heatmap.push({
      slotIndex: s,
      startMinutes,
      endMinutes,
      presentWeight: present,
      sampleWeight: sample,
      confidence,
    });
  }

  return {
    heatmap,
    meta: {
      daysRequested: days,
      daysIncluded: includedDays.length,
      slotMinutes,
      recencyHalfLifeDays,
    },
  };
}


