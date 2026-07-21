import { type Attendance } from "@prisma/client";
import { db, ONE_DAY_IN_MS } from ".";
import { getStartOfDay, getEndOfDay } from "./util";
import EventEmitter from "events";

const DEFAULT_MAX_OPEN_SEGMENT_HOURS = 16;
console.log("Loading attendances.ts module");

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

    const listener = (data: Parameters<AttendanceEvents[K]>[0]) => {
      const resolve = queue.shift();
      if (resolve) {
        resolve({ value: [data], done: false });
      } else {
        events.push([data]);
      }
    };

    this.on(event, listener);

    const cleanup = () => {
      this.removeListener(event, listener);
      console.log(
        `Removed listener for ${String(event)}, remaining: ${this.listenerCount(event)}`,
      );
    };

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
              cleanup();
              return { value: undefined, done: true };
            }

            return new Promise((resolve) => {
              queue.push(resolve);

              if (opts.signal) {
                const abortHandler = () => {
                  const index = queue.indexOf(resolve);
                  if (index >= 0) queue.splice(index, 1);
                  resolve({ value: undefined, done: true });
                };

                opts.signal.addEventListener("abort", abortHandler, {
                  once: true,
                });
              }
            });
          },
          return: async (): Promise<
            IteratorResult<[Parameters<AttendanceEvents[K]>[0]]>
          > => {
            cleanup();
            return { value: undefined, done: true };
          },
        };
      },
    };
  }
}

export const activeSubscriptions = new Map<string, AbortController>();

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
const BD_WEEKEND_DAYS = new Set<number>([5, 6]);
const isWeekendBD = (dateOrDow: Date | number): boolean => {
  const dow = typeof dateOrDow === "number" ? dateOrDow : dateOrDow.getDay();
  return BD_WEEKEND_DAYS.has(dow);
};

export function getWeekDateRange(date: Date): { start: Date; end: Date } {
  const dow = date.getDay();
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

export function getStartAndEndOfDay(now: Date): { start: Date; end: Date } {
  return {
    start: getStartOfDay(now),
    end: getEndOfDay(now),
  };
}

function getDateRangePayload(date: Date) {
  const { start, end } = getStartAndEndOfDay(date);
  return { gte: start, lte: end };
}

export const getAttendanceForUser = async (
  userId: string,
  date = new Date(),
) => {
  return db.attendance.findFirst({
    where: {
      userId,
      date: getDateRangePayload(date),
    },
  });
};

export const getAttendancesInDateRange = async (
  userId: string,
  startDate: Date,
  endDate: Date,
): Promise<Attendance[]> => {
  return db.attendance.findMany({
    where: {
      userId,
      date: { gte: startDate, lte: endDate },
    },
  });
};

export const countWorkingDays = (startDate: Date, endDate: Date): number => {
  let count = 0;
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    if (!isWeekendBD(currentDate.getDay())) count++;
    currentDate.setDate(currentDate.getDate() + 1);
  }
  return count;
};

/**
 * Returns true if the user has an open (not yet ended) work segment today.
 */
export const hasActiveWorkSegment = async (userId: string): Promise<boolean> => {
  const attendance = await db.attendance.findFirst({
    where: { userId, date: getDateRangePayload(new Date()) },
    select: { workSegments: true },
  });
  if (!attendance) return false;
  return attendance.workSegments.some((seg) => !seg.end);
};

/**
 * Start a new work segment for the user.
 * Creates today's Attendance record if one doesn't exist yet.
 * Returns a string error message if the user already has an open segment.
 */
export const startWorkSegment = async (userId: string, project: string) => {
  const now = new Date();

  let attendance = await db.attendance.findFirst({
    where: { userId, date: getDateRangePayload(now) },
  });

  if (!attendance) {
    attendance = await db.attendance.create({
      data: {
        userId,
        date: getStartOfDay(now),
        workSegments: [{ start: now, end: null, project, length_ms: null }],
      },
    });
    attendanceEvents.emit("attendanceUpdated", attendance);
    return attendance;
  }

  const hasOpen = attendance.workSegments.some((seg) => !seg.end);
  if (hasOpen) {
    return "❌ You already have an active work segment.";
  }

  attendance = await db.attendance.update({
    where: { id: attendance.id },
    data: {
      workSegments: {
        push: { start: now, end: null, project, length_ms: null },
      },
    },
  });

  attendanceEvents.emit("attendanceUpdated", attendance);
  return attendance;
};

/**
 * End the latest open work segment for the user.
 * Returns null if no open segment exists today.
 */
export const endWorkSegment = async (userId: string) => {
  const now = new Date();
  const attendance = await db.attendance.findFirst({
    where: { userId, date: getDateRangePayload(now) },
  });

  if (!attendance) return null;

  const segments = [...attendance.workSegments];
  const lastSeg = segments[segments.length - 1];
  if (!lastSeg || lastSeg.end) return null;

  lastSeg.end = now;
  lastSeg.length_ms = now.getTime() - lastSeg.start.getTime();

  const totalWork = segments.reduce((sum, seg) => sum + (seg.length_ms ?? 0), 0);

  const updated = await db.attendance.update({
    where: { id: attendance.id },
    data: { workSegments: segments, totalWork },
  });

  attendanceEvents.emit("attendanceUpdated", updated);
  return updated;
};

// ---- Weekday Availability Heatmap ----

interface WeekdayHeatmapSlot {
  slotIndex: number;
  startMinutes: number;
  endMinutes: number;
  presentWeight: number;
  sampleWeight: number;
  confidence: number;
}

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
      meta: { daysRequested: days, daysIncluded: 0, slotMinutes, recencyHalfLifeDays },
    };
  }

  const endOfToday = getEndOfDay(new Date());
  const startDate = new Date(endOfToday);
  startDate.setDate(startDate.getDate() - (days - 1));
  const startOfStart = getStartOfDay(startDate);

  const attendances = await db.attendance.findMany({
    where: {
      userId,
      date: {
        gte: new Date(startOfStart.getTime() - ONE_DAY_IN_MS),
        lte: endOfToday,
      },
    },
  });

  const slotsPerDay = Math.floor((24 * 60) / slotMinutes);
  const presentWeights: number[] = Array(slotsPerDay).fill(0);
  const sampleWeights: number[] = Array(slotsPerDay).fill(0);

  const includedDays: { start: Date; end: Date; weight: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(endOfToday);
    d.setDate(d.getDate() - i);
    const dayStart = getStartOfDay(d);
    const dayEnd = getEndOfDay(d);
    if (isWeekendBD(dayStart.getDay())) continue;

    const ageDays = Math.floor(
      (endOfToday.getTime() - dayEnd.getTime()) / ONE_DAY_IN_MS,
    );
    const weight = Math.pow(0.5, ageDays / recencyHalfLifeDays);
    includedDays.push({ start: dayStart, end: dayEnd, weight });
  }

  for (const day of includedDays) {
    const intervals: Array<{ start: Date; end: Date }> = [];
    for (const a of attendances) {
      for (const seg of a.workSegments) {
        const segStart = new Date(seg.start);
        let segEnd = seg.end ? new Date(seg.end) : new Date();

        if (!seg.end) {
          const cap = new Date(
            segStart.getTime() + maxOpenSegmentHours * 60 * 60 * 1000,
          );
          if (segEnd > cap) segEnd = cap;
        }

        if (isNaN(segStart.getTime()) || isNaN(segEnd.getTime())) continue;
        if (segEnd <= segStart) continue;

        if (segStart <= day.end && segEnd >= day.start) {
          const s = new Date(Math.max(segStart.getTime(), day.start.getTime()));
          const e = new Date(Math.min(segEnd.getTime(), day.end.getTime()));
          if (e > s) intervals.push({ start: s, end: e });
        }
      }
    }

    for (let s = 0; s < slotsPerDay; s++) {
      const slotStart = new Date(
        day.start.getTime() + s * slotMinutes * 60_000,
      );
      const slotEnd = new Date(slotStart.getTime() + slotMinutes * 60_000);

      sampleWeights[s] += day.weight;

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
    heatmap.push({
      slotIndex: s,
      startMinutes,
      endMinutes,
      presentWeight: present,
      sampleWeight: sample,
      confidence: sample > 0 ? present / sample : 0,
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
