import { type Attendance, type User } from "@prisma/client";
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

interface WorkAggregate {
  totalMs: number;
  daysWorked: number;
  perProject: { project: string; ms: number }[];
}

interface MonthlyWorkReport extends WorkAggregate {
  rangeStart: Date;
  rangeEnd: Date;
}

interface EmployeeMonthlyWork extends WorkAggregate {
  user: User;
}

const getMonthRange = (date: Date): { rangeStart: Date; rangeEnd: Date } => ({
  rangeStart: getStartOfDay(new Date(date.getFullYear(), date.getMonth(), 1)),
  rangeEnd: getEndOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0)),
});

/**
 * Median duration (in ms) of a user's *closed* work segments. Used as the basis
 * for estimating open (corrupted) segments. Open segments are excluded so the
 * estimate never feeds on itself. Returns 0 when there's nothing to learn from.
 */
const medianClosedSegmentMs = (attendances: Attendance[]): number => {
  const durations: number[] = [];
  for (const attendance of attendances) {
    for (const segment of attendance.workSegments) {
      const ms =
        segment.length_ms ??
        (segment.end ? segment.end.getTime() - segment.start.getTime() : null);
      if (ms != null && ms > 0) durations.push(ms);
    }
  }
  if (!durations.length) return 0;
  durations.sort((a, b) => a - b);
  const mid = Math.floor(durations.length / 2);
  return durations.length % 2 === 0
    ? (durations[mid - 1] + durations[mid]) / 2
    : durations[mid];
};

/**
 * Sum work across a set of attendances, grouped by project.
 *
 * Open (never-closed) segments are corrupted data (a missed logout). When
 * `medianSessionMs` is provided, each one is *estimated* as that typical session
 * length, capped by the latest it could plausibly have run — the next segment's
 * start or the end of its day, whichever is earlier. Without a median (the user
 * has no closed sessions to learn from) the open segment is skipped. Either way
 * every open segment is logged so it can be verified/fixed manually.
 */
const aggregateWork = (
  attendances: Attendance[],
  medianSessionMs = 0,
): WorkAggregate => {
  const projectTotals = new Map<string, number>();
  let totalMs = 0;
  let daysWorked = 0;

  for (const attendance of attendances) {
    const dayEndMs = getEndOfDay(attendance.date).getTime();
    const segments = [...attendance.workSegments].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    let dayMs = 0;

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i];
      const isOpen = !segment.end && segment.length_ms == null;

      let ms: number;
      if (isOpen) {
        // Ceiling: the open segment can't have run past the next segment's
        // start, nor past the end of its own day.
        const nextStartMs = segments[i + 1]?.start.getTime() ?? dayEndMs;
        const ceilingMs =
          Math.min(nextStartMs, dayEndMs) - segment.start.getTime();

        if (medianSessionMs <= 0 || ceilingMs <= 0) {
          console.warn(
            "[aggregateWork] skipping open work segment (no basis to estimate): " +
              `user=${attendance.userId} date=${attendance.date.toISOString()} ` +
              `project=${segment.project} start=${segment.start.toISOString()}`,
          );
          continue;
        }

        ms = Math.min(medianSessionMs, ceilingMs);
        console.warn(
          "[aggregateWork] estimating open work segment (corrupted data): " +
            `user=${attendance.userId} date=${attendance.date.toISOString()} ` +
            `project=${segment.project} start=${segment.start.toISOString()} ` +
            `estimatedMs=${Math.round(ms)} ` +
            `(median=${Math.round(medianSessionMs)}, ceiling=${Math.round(ceilingMs)})`,
        );
      } else {
        ms =
          segment.length_ms ??
          (segment.end
            ? Math.max(0, segment.end.getTime() - segment.start.getTime())
            : 0);
        if (ms <= 0) continue;
      }

      dayMs += ms;
      projectTotals.set(
        segment.project,
        (projectTotals.get(segment.project) ?? 0) + ms,
      );
    }

    if (dayMs > 0) daysWorked++;
    totalMs += dayMs;
  }

  const perProject = [...projectTotals.entries()]
    .map(([project, ms]) => ({ project, ms }))
    .sort((a, b) => b.ms - a.ms);

  return { totalMs, daysWorked, perProject };
};

/**
 * Aggregate one user's work for the calendar month containing `date`.
 */
export const getMonthlyWorkReport = async (
  userId: string,
  date = new Date(),
): Promise<MonthlyWorkReport> => {
  const { rangeStart, rangeEnd } = getMonthRange(date);
  const [attendances, recentAttendances] = await Promise.all([
    getAttendancesInDateRange(userId, rangeStart, rangeEnd),
    getAttendancesInDateRange(
      userId,
      new Date(Date.now() - 30 * ONE_DAY_IN_MS),
      new Date(),
    ),
  ]);
  const medianSessionMs = medianClosedSegmentMs(recentAttendances);
  return {
    rangeStart,
    rangeEnd,
    ...aggregateWork(attendances, medianSessionMs),
  };
};

/**
 * Aggregate every current employee's work for the calendar month containing
 * `date`. Fetches all in-range attendances in a single query and groups them
 * per user. Employees with no work in the month are returned with zeroed totals.
 */
export const getMonthlyWorkReportForAllEmployees = async (
  date = new Date(),
): Promise<EmployeeMonthlyWork[]> => {
  const { rangeStart, rangeEnd } = getMonthRange(date);
  const recentWindowStart = new Date(Date.now() - 30 * ONE_DAY_IN_MS);

  const [employees, attendances, recentAttendances] = await Promise.all([
    db.user.findMany({ where: { exEmployee: false } }),
    db.attendance.findMany({
      where: { date: { gte: rangeStart, lte: rangeEnd } },
    }),
    db.attendance.findMany({
      where: { date: { gte: recentWindowStart } },
    }),
  ]);

  const groupByUser = (records: Attendance[]): Map<string, Attendance[]> => {
    const map = new Map<string, Attendance[]>();
    for (const record of records) {
      const list = map.get(record.userId) ?? [];
      list.push(record);
      map.set(record.userId, list);
    }
    return map;
  };
  const attendancesByUser = groupByUser(attendances);
  const recentByUser = groupByUser(recentAttendances);

  return employees.map((user) => ({
    user,
    ...aggregateWork(
      attendancesByUser.get(user.id) ?? [],
      medianClosedSegmentMs(recentByUser.get(user.id) ?? []),
    ),
  }));
};

interface ProjectEmployeeWork {
  user: User;
  totalMs: number;
  daysWorked: number;
  descriptions: string[];
}

interface ProjectWorkReport {
  rangeStart: Date;
  rangeEnd: Date;
  totalMs: number;
  perEmployee: ProjectEmployeeWork[];
}

/**
 * Aggregate work on a single project (matched by segment `project` name) across
 * all employees within a date range, grouped per employee with their task
 * descriptions. Open segments are counted up to `now`. Employees are sorted by
 * hours worked, descending.
 */
export const getProjectWorkReport = async (
  projectName: string,
  startDate: Date,
  endDate: Date,
): Promise<ProjectWorkReport> => {
  const attendances = await db.attendance.findMany({
    where: { date: { gte: startDate, lte: endDate } },
  });

  const target = projectName.toLowerCase();
  const now = new Date();

  interface Accumulator {
    totalMs: number;
    days: Set<string>;
    descriptions: string[];
  }
  const byUser = new Map<string, Accumulator>();
  let totalMs = 0;

  for (const attendance of attendances) {
    const dayKey = getStartOfDay(attendance.date).toISOString();
    for (const segment of attendance.workSegments) {
      if (segment.project.toLowerCase() !== target) continue;
      const end = segment.end ?? now;
      const ms =
        segment.length_ms ?? Math.max(0, end.getTime() - segment.start.getTime());
      if (ms <= 0) continue;

      const acc = byUser.get(attendance.userId) ?? {
        totalMs: 0,
        days: new Set<string>(),
        descriptions: [],
      };
      acc.totalMs += ms;
      acc.days.add(dayKey);
      if (segment.description) acc.descriptions.push(segment.description);
      byUser.set(attendance.userId, acc);
      totalMs += ms;
    }
  }

  const userIds = [...byUser.keys()];
  const users = userIds.length
    ? await db.user.findMany({ where: { id: { in: userIds } } })
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));

  const perEmployee: ProjectEmployeeWork[] = [];
  for (const [userId, acc] of byUser) {
    const user = userById.get(userId);
    if (!user) continue;
    perEmployee.push({
      user,
      totalMs: acc.totalMs,
      daysWorked: acc.days.size,
      descriptions: acc.descriptions,
    });
  }
  perEmployee.sort((a, b) => b.totalMs - a.totalMs);

  return { rangeStart: startDate, rangeEnd: endDate, totalMs, perEmployee };
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
 * End the user's most recent open work segment.
 *
 * Looks back to the start of yesterday, not just "today", so a session that
 * crossed local midnight (opened before midnight, closed after it) can still be
 * closed. Attendance records are dated to the day the segment *started*, so
 * without this a midnight-crossing segment would be orphaned open forever —
 * its parent attendance sits on the previous day and today's query never sees
 * it. Returns null if no open segment exists in that window.
 */
export const endWorkSegment = async (userId: string) => {
  const now = new Date();
  const lookbackStart = getStartOfDay(new Date(now.getTime() - ONE_DAY_IN_MS));
  const recentAttendances = await db.attendance.findMany({
    where: { userId, date: { gte: lookbackStart, lte: now } },
    orderBy: { date: "desc" },
  });

  // Most recent attendance that still has an open (unclosed) segment.
  const attendance = recentAttendances.find((a) =>
    a.workSegments.some((seg) => !seg.end),
  );
  if (!attendance) return null;

  const segments = [...attendance.workSegments];
  // The open segment is the last one without an end time.
  let openIndex = -1;
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!segments[i].end) {
      openIndex = i;
      break;
    }
  }
  if (openIndex === -1) return null;
  const lastSeg = segments[openIndex];

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

/**
 * Set the free-text description on one work segment, located by its parent
 * attendance id and the segment's start time (segments have no id of their
 * own). Returns the segment's project on success, or null if it's gone.
 */
export const setWorkSegmentDescription = async (
  attendanceId: string,
  segmentStartMs: number,
  description: string,
): Promise<{ project: string } | null> => {
  const attendance = await db.attendance.findUnique({
    where: { id: attendanceId },
  });
  if (!attendance) return null;

  const segments = [...attendance.workSegments];
  const target = segments.find((seg) => seg.start.getTime() === segmentStartMs);
  if (!target) return null;

  target.description = description;

  const updated = await db.attendance.update({
    where: { id: attendance.id },
    data: { workSegments: segments },
  });
  attendanceEvents.emit("attendanceUpdated", updated);
  return { project: target.project };
};

/**
 * Read one work segment's description, used to decide whether a follow-up
 * reminder is still needed. `found` is false if the segment no longer exists.
 */
export const getWorkSegmentDescription = async (
  attendanceId: string,
  segmentStartMs: number,
): Promise<{ found: boolean; description: string | null }> => {
  const attendance = await db.attendance.findUnique({
    where: { id: attendanceId },
    select: { workSegments: true },
  });
  const target = attendance?.workSegments.find(
    (seg) => seg.start.getTime() === segmentStartMs,
  );
  if (!target) return { found: false, description: null };
  return { found: true, description: target.description ?? null };
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
