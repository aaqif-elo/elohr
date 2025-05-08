import { Attendance } from "@prisma/client";
import { db, getEndOfDay, getStartOfDay, ONE_DAY_IN_MS } from ".";
import { ChangeStream, ChangeStreamDocument, MongoClient } from "mongodb";
import EventEmitter, { on } from "events";
import { generateJWTFromUserId } from "../api/routers";
import { getAttendanceStatsImage } from "../services/discord/utils";

let changeStream: ChangeStream<
    Document,
    ChangeStreamDocument<Document>
  > | null = null,
  client: MongoClient | null = null;

const attendanceCache = new Map<string, Attendance>();

export interface AttendanceEvents {
  attendanceUpdated: (attendance: Attendance) => void;
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

class AttendanceEventEmitter extends EventEmitter {
  public toIterable<K extends keyof AttendanceEvents>(
    event: K,
    opts: NonNullable<Parameters<typeof on>[2]>
  ): AsyncIterable<Parameters<AttendanceEvents[K]>> {
    return on(this, event, opts) as any;
  }
}

export const attendanceEvents = new AttendanceEventEmitter();

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

const generateCacheKey = (userId: string, date: Date) =>
  `${userId}-${date.toLocaleDateString().replaceAll("/", "-")}`;

const updateCacheForUser = async (userId: string, date: Date) => {
  const attendance = await db.attendance.findFirst({
    where: {
      userId,
      login: getDateRangePayload(date),
    },
  });

  if (attendance) {
    const cacheKey = generateCacheKey(userId, date);
    attendanceCache.set(cacheKey, attendance);
  }
};

const getCachedAttendance = async (userId: string, date: Date) => {
  const cacheKey = generateCacheKey(userId, date);
  if (!attendanceCache.has(cacheKey)) {
    await updateCacheForUser(userId, date);
  }
  return attendanceCache.get(cacheKey) || null;
};

const updateCacheForDocument = async (attendanceId: string) => {
  const attendance = await db.attendance.findFirst({
    where: {
      id: attendanceId,
    },
  });
  if (attendance) {
    const cacheKey = generateCacheKey(
      attendance.userId,
      new Date(attendance.login)
    );
    attendanceCache.set(cacheKey, attendance);
    attendanceEvents.emit("attendanceUpdated", attendance);
  }
};

const attendanceWatcher = async () => {
  if (
    !process.env.DB_URL ||
    !process.env.ATTENDANCE_DB ||
    !process.env.ATTENDANCE_COLLECTION
  ) {
    throw new Error("Missing environment variables for attendance watcher");
  }
  console.log("starting attendance watcher", client);
  client = new MongoClient(process.env.DB_URL);
  await client.connect();
  console.log("client connected", client);

  const attendanceDb = client.db(process.env.ATTENDANCE_DB);
  const attendanceCollection = attendanceDb.collection(
    process.env.ATTENDANCE_COLLECTION
  );

  changeStream = attendanceCollection.watch();
  changeStream.on("change", (next) => {
    // Print any change event

    if (next.operationType === "update" || next.operationType === "insert") {
      updateCacheForDocument(next.documentKey._id.toString());
    }
  });
};

export const getAttendanceForUser = async (userId: string, date?: Date) => {
  let watcher = false;
  if (!date) {
    watcher = true;
    date = new Date();
  } else if (new Date().getTime() - date.getTime() < ONE_DAY_IN_MS) {
    watcher = true;
  }

  if (watcher && !client) {
    await attendanceWatcher();
  }

  return getCachedAttendance(userId, date);
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

  return `${prefix} for ${Math.round(
    lastBreak.length_ms / (1000 * 60)
  )} minutes ended at ${lastBreak.end.toLocaleString()}`;
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
  const logoutTime = new Date();
  const attendance = await getLoggedInAttendance(userId);
  if (!attendance) {
    return null;
  }

  if ((await canBreak(userId)) !== true) {
    await breakEnd(userId);
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

  await db.attendance.update({
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

  const jwtWithUser = await generateJWTFromUserId(userId);

  const token = jwtWithUser?.jwt;

  if (!token) {
    return {
      report: null,
      time: logoutTime,
    };
  }
  const attendanceImage = await getAttendanceStatsImage(token);

  return {
    report: attendanceImage,
    time: logoutTime,
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

  return true;
};
