import { Attendance } from "@prisma/client";
import { db, ONE_DAY_IN_MS } from ".";
import { getStartOfDay, getEndOfDay } from "./util";
import EventEmitter from "events";
import { generateJWTFromUserId } from "../api/routers";
import {
  generateTextAttendanceReport,
  queueAttendanceStatsImage,
} from "../services/discord/utils";

// Add this near the top after imports
console.log("Loading attendances.ts module");

// Global declaration
declare global {
  var _attendanceEventsGlobal: AttendanceEventEmitter | undefined;
}

export interface AttendanceEvents {
  attendanceUpdated: (attendance: Attendance) => void;
}

class AttendanceEventEmitter extends EventEmitter {
  public toIterable<K extends keyof AttendanceEvents>(
    event: K,
    opts: { signal?: AbortSignal }
  ): AsyncIterable<[Parameters<AttendanceEvents[K]>[0]]> {
    const events: [Parameters<AttendanceEvents[K]>[0]][] = [];
    const queue: ((
      value: IteratorResult<[Parameters<AttendanceEvents[K]>[0]]>
    ) => void)[] = [];

    // Create the event listener that will be attached
    const listener = (data: Parameters<AttendanceEvents[K]>[0]) => {
      if (queue.length > 0) {
        const resolve = queue.shift()!;
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
          event
        )}`
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
              return { value: events.shift()!, done: false };
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
  if (activeSubscriptions.has(userId)) {
    console.log(`Cleaning up existing subscription for user ${userId}`);
    const controller = activeSubscriptions.get(userId)!;
    controller.abort();
    activeSubscriptions.delete(userId);
    return true;
  }
  return false;
}

// Function to register a new subscription
export function registerSubscription(
  userId: string,
  controller: AbortController
): void {
  activeSubscriptions.set(userId, controller);
  console.log(`Registered subscription for user ${userId}`);
  console.log(`Total active subscriptions: ${activeSubscriptions.size}`);
}

declare interface AttendanceEventEmitter {
  on<K extends keyof AttendanceEvents>(
    event: K,
    listener: AttendanceEvents[K]
  ): this;
  off<K extends keyof AttendanceEvents>(
    event: K,
    listener: AttendanceEvents[K]
  ): this;
  once<K extends keyof AttendanceEvents>(
    event: K,
    listener: AttendanceEvents[K]
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
  attendanceEvents
);

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
  date = new Date()
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
  endDate: Date
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
  holidays: Date[] = []
): number => {
  let count = 0;
  const currentDate = new Date(startDate);

  // Create a set of holiday dates for faster lookup
  const holidaySet = new Set(
    holidays.map((date) => new Date(date).toISOString().split("T")[0])
  );

  // Loop through each day in the range
  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    const dateString = currentDate.toISOString().split("T")[0];

    // Skip weekends (0 = Sunday, 6 = Saturday) and holidays
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet.has(dateString)) {
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
export const getLoggedInAttendance = async (
  userId: string,
  date = new Date()
) => {
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

  let prefix = "";
  if (!lastBreak.reason) {
    prefix = "Break";
  } else {
    prefix = lastBreak.reason + " break";
  }
  attendanceEvents.emit("attendanceUpdated", attendance);
  return `${prefix} for ${Math.round(
    lastBreak.length_ms / (1000 * 60)
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
 * Checks if a user has an active login session from yesterday
 * @param userId
 * @returns A boolean indicating if the user has an active login session from yesterday
 */
export const hasActiveLoginSessionFromYesterday = async (userId: string) => {
  const yesterday = new Date(Date.now() - ONE_DAY_IN_MS);
  const attendance = await getLoggedInAttendance(userId, yesterday);

  return attendance !== null;
};

/**
 * Get the logout time for a user
 * @param userId
 * @returns A date object representing the logout time, or null if not found
 */
export const getLogoutTime = async (userId: string) => {
  const attendance = await db.attendance.findFirst({
    where: {
      userId,
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
  return attendance ? attendance.logout : null;
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
 * @returns A promise for the image generation
 */
export const generateAttendanceImageReport = async (userId: string) => {
  const jwtWithUser = await generateJWTFromUserId(userId);
  if (!jwtWithUser?.jwt) {
    return null;
  }

  // Return the promise for the image generation
  return queueAttendanceStatsImage(
    jwtWithUser.jwt,
    jwtWithUser.userWithAttendance.user.isAdmin
  );
};
