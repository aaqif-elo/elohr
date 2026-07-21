import { authProcedure, createTRPCRouter } from "../trpc";

import {
  getAttendanceForUser,
  attendanceEvents,
  getAttendancesInDateRange,
  countWorkingDays,
  cleanupExistingSubscription,
  registerSubscription,
  activeSubscriptions,
  getWrappedStats,
} from "../../db";

import {
  object,
  string,
  isoTimestamp,
  pipe,
  parseAsync,
  optional,
} from "valibot";

import { tracked } from "@trpc/server";
import type { Attendance } from "@prisma/client";
import type { TimeUnit } from "../../../types/attendance";

export const attendanceRouter = createTRPCRouter({
  getAttendance: authProcedure
    .input((data) =>
      parseAsync(
        object({
          date: pipe(string(), isoTimestamp()),
        }),
        data
      )
    )
    .query(async (opts) => {
      const userId = opts.ctx.user.dbId;
      if (!userId) return null;

      const dateString = opts.input.date;
      let dateFilter: Date | undefined = undefined;

      const validatedDate = new Date(dateString);
      if (validatedDate.toString() !== "Invalid Date") {
        dateFilter = validatedDate;
      }

      return getAttendanceForUser(userId, dateFilter);
    }),
  attendanceChanged: authProcedure.subscription(async function* (opts) {
    const userId = opts.ctx.user.dbId;
    if (!userId) return;

    // Create a dedicated abort controller for this subscription
    const controller = new AbortController();

    // Clean up any existing subscription for this user
    cleanupExistingSubscription(userId);

    // Register the new subscription
    registerSubscription(userId, controller);

    // Create a function to filter events for this specific user
    function* maybeYield(attendance: Attendance) {
      if (userId !== attendance.userId) {
        return;
      }
      yield tracked(userId, attendance);
    }

    // Create a cleanup function that will be called ONCE
    let cleanupDone = false;
    const performCleanup = () => {
      if (cleanupDone) return;
      cleanupDone = true;

      activeSubscriptions.delete(userId);
    };

    // Ensure cleanup is performed in all cases
    if (opts.signal) {
      opts.signal.addEventListener("abort", performCleanup, { once: true });
      controller.signal.addEventListener("abort", performCleanup, {
        once: true,
      });

      try {
        // Create the iterable with its own signal
        for await (const [data] of attendanceEvents.toIterable(
          "attendanceUpdated",
          {
            signal: AbortSignal.any([opts.signal, controller.signal]),
          }
        )) {
          yield* maybeYield(data);
        }
      } finally {
        performCleanup();
      }
    }
  }),
  getAttendanceSummary: authProcedure
    .input((data) =>
      parseAsync(
        object({
          startDate: pipe(string(), isoTimestamp()),
          endDate: pipe(string(), isoTimestamp()),
          unit: string(), // Accepts 'week', 'month', 'quarter', 'year'
          userId: optional(string()),
        }),
        data
      )
    )
    .query(async (opts) => {
      const userId = opts.input.userId || opts.ctx.user.dbId;
      if (!userId) return null;

      const startDate = new Date(opts.input.startDate);
      const endDate = new Date(opts.input.endDate);
      const unit = opts.input.unit as TimeUnit;

      // Get all necessary data
      const attendances = await getAttendancesInDateRange(
        userId,
        startDate,
        endDate
      );

      // Calculate total work days (excluding weekends)
      const totalWorkDays = countWorkingDays(startDate, endDate);

      // Calculate days worked (with actual dates)
      const workedDates = attendances.map((a) => {
        const d = new Date(a.date);
        d.setHours(23, 59, 59, 999);
        return d.toISOString().split("T")[0];
      });
      const uniqueWorkedDates = [...new Set(workedDates)].map((dateStr) =>
        new Date(dateStr).toISOString()
      );

      // Calculate absent dates
      const absentDates: string[] = [];
      const currentDay = new Date(startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      while (currentDay <= endDate) {
        currentDay.setHours(23, 59, 59, 999);

        const currentDateStr = currentDay.toISOString().split("T")[0];
        const isWeekend = [5, 6].includes(currentDay.getDay());
        const isFutureDay = currentDay > today;

        if (!isWeekend && !isFutureDay) {
          const isWorked = uniqueWorkedDates.some(
            (date) => date.split("T")[0] === currentDateStr
          );
          if (!isWorked) {
            absentDates.push(currentDay.toISOString());
          }
        }

        currentDay.setDate(currentDay.getDate() + 1);
      }

      return {
        timeRange: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        },
        unit,
        value: unit,
        stats: {
          daysWorked: uniqueWorkedDates.length,
          daysAbsent: absentDates.length,
          totalWorkDays,
          workedDates: uniqueWorkedDates,
          absentDates,
        },
      };
    }),
  getWrapped: authProcedure
    .input((data) =>
      parseAsync(
        object({
          year: optional(string()),
        }),
        data
      )
    )
    .query(async (opts) => {
      const userId = opts.ctx.user.dbId;
      if (!userId) return null;

      const year = opts.input.year
        ? parseInt(opts.input.year, 10)
        : new Date().getFullYear();

      return getWrappedStats(userId, year);
    }),
});
