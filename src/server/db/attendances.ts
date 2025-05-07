import {Attendance} from '@prisma/client';
import {db} from '.';
import {ChangeStream, ChangeStreamDocument, MongoClient} from 'mongodb';
import EventEmitter, {on} from 'events';

let changeStream: ChangeStream<Document, ChangeStreamDocument<Document>> | null = null,
  client: MongoClient | null = null;

const attendanceCache = new Map<string, Attendance>();

export interface AttendanceEvents {
  attendanceUpdated: (attendance: Attendance) => void;
}

declare interface AttendanceEventEmitter {
  on<K extends keyof AttendanceEvents>(event: K, listener: AttendanceEvents[K]): this;
  off<K extends keyof AttendanceEvents>(event: K, listener: AttendanceEvents[K]): this;
  once<K extends keyof AttendanceEvents>(event: K, listener: AttendanceEvents[K]): this;
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
export function getStartAndEndOfDay(now: Date): {start: Date; end: Date} {
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();

  // Start of today
  const start = new Date(year, month, day, 0, 0, 0, 0);

  // End of today
  const end = new Date(year, month, day, 23, 59, 59, 999);

  return {start, end};
}

const generateCacheKey = (userId: string, date: Date) =>
  `${userId}-${date.toLocaleDateString().replaceAll('/', '-')}`;

const updateCacheForUser = async (userId: string, date: Date) => {
  const {start, end} = getStartAndEndOfDay(date);
  const attendance = await db.attendance.findFirst({
    where: {
      userId,
      login: {
        gte: start,
        lte: end,
      },
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
    const cacheKey = generateCacheKey(attendance.userId, new Date(attendance.login));
    attendanceCache.set(cacheKey, attendance);
    attendanceEvents.emit('attendanceUpdated', attendance);
  }
};

const attendanceWatcher = async () => {
  if (!process.env.DB_URL || !process.env.ATTENDANCE_DB || !process.env.ATTENDANCE_COLLECTION) {
    throw new Error('Missing environment variables for attendance watcher');
  }
  console.log('starting attendance watcher', client);
  client = new MongoClient(process.env.DB_URL);
  await client.connect();
  console.log('client connected', client);

  const attendanceDb = client.db(process.env.ATTENDANCE_DB);
  const attendanceCollection = attendanceDb.collection(process.env.ATTENDANCE_COLLECTION);

  changeStream = attendanceCollection.watch();
  changeStream.on('change', next => {
    // Print any change event

    if (next.operationType === 'update' || next.operationType === 'insert') {
      updateCacheForDocument(next.documentKey._id.toString());
    }
  });
};

export const getAttendanceForUser = async (userId: string, date?: Date) => {
  const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
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
export const countWorkingDays = (startDate: Date, endDate: Date, holidays: Date[] = []): number => {
  let count = 0;
  const currentDate = new Date(startDate);

  // Create a set of holiday dates for faster lookup
  const holidaySet = new Set(holidays.map(date => new Date(date).toISOString().split('T')[0]));

  // Loop through each day in the range
  while (currentDate <= endDate) {
    const dayOfWeek = currentDate.getDay();
    const dateString = currentDate.toISOString().split('T')[0];

    // Skip weekends (0 = Sunday, 6 = Saturday) and holidays
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidaySet.has(dateString)) {
      count++;
    }

    // Move to next day
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return count;
};
