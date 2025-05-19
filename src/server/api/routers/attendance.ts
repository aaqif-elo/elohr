import { authProcedure, createTRPCRouter } from "../trpc";

import {
  getAttendanceForUser,
  attendanceEvents,
  getAttendancesInDateRange,
  countWorkingDays,
  getLeavesInDateRange,
  getHolidaysForDateRange,
  cleanupExistingSubscription,
  registerSubscription,
  activeSubscriptions,
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
import { Attendance } from "@prisma/client";
import { TimeUnit, TrpcLeaveInfo } from "../../../types/attendance";

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
    const hadPrevious = cleanupExistingSubscription(userId);
    if (hadPrevious) {
      console.log(`Cleaned up previous subscription for user ${userId}`);
    }

    // Register the new subscription
    registerSubscription(userId, controller);

    // Log subscription start
    console.log(`User ${userId} subscribing to attendance changes`);

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

      console.log(`Final cleanup for user ${userId}`);
      activeSubscriptions.delete(userId);
    };

    // Ensure cleanup is performed in all cases
    if (opts.signal) {
      opts.signal.addEventListener("abort", performCleanup, { once: true });
      controller.signal.addEventListener("abort", performCleanup, {
        once: true,
      });

      try {
        // First log the current count for debugging
        console.log(
          `Current listener count: ${attendanceEvents.listenerCount(
            "attendanceUpdated"
          )}`
        );

        // Create the iterable with its own signal
        for await (const [data] of attendanceEvents.toIterable(
          "attendanceUpdated",
          {
            signal: AbortSignal.any([opts.signal, controller.signal]),
          }
        )) {
          console.log(`Received attendance data for user: ${data.userId}`);
          yield* maybeYield(data);
        }
      } finally {
        console.log(`User ${userId} subscription ended`);
        performCleanup();
        console.log(
          `Remaining listeners: ${attendanceEvents.listenerCount(
            "attendanceUpdated"
          )}`
        );
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

      const leaves = await getLeavesInDateRange(startDate, endDate, userId);
      const holidays = await getHolidaysForDateRange(startDate, endDate);

      // Extract holiday dates
      const holidayDates = holidays.map(
        (h) => h.overridenDate || h.originalDate
      );

      // Calculate total work days (excluding weekends and holidays)
      const totalWorkDays = countWorkingDays(startDate, endDate, holidayDates);

      // Calculate days worked (with actual dates)
      const workedDates = attendances.map((a) => {
        const d = new Date(a.login);
        d.setHours(23, 59, 59, 999);
        return d.toISOString().split("T")[0];
      });
      const uniqueWorkedDates = [...new Set(workedDates)].map((dateStr) =>
        new Date(dateStr).toISOString()
      );

      // Calculate leave dates and detailed leave info
      const leaveDates: string[] = [];
      const leaveInfo: TrpcLeaveInfo[] = [];

      leaves.forEach((leave) => {
        leave.dates.forEach((date) => {
          if (date >= startDate && date <= endDate) {
            leaveDates.push(date.toISOString());

            // Add detailed leave info
            leaveInfo.push({
              date: date.toISOString(),
              reason: leave.reason || undefined,
              approved: leave.reviewed ? leave.reviewed.approved : undefined,
              approvedBy: leave.reviewed ? leave.reviewed.by : undefined,
              approvedDate: leave.reviewed
                ? leave.reviewed.date.toISOString()
                : undefined,
            });
          }
        });
      });

      // Calculate absent dates
      const absentDates: string[] = [];
      // Loop through all work days in the range
      let currentDay = new Date(startDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0); // Reset time to start of day for accurate comparison

      while (currentDay <= endDate) {
        currentDay.setHours(23, 59, 59, 999); // Set to end of day for accurate comparison

        const currentDateStr = currentDay.toISOString().split("T")[0];
        const isWeekend = [5, 6].includes(currentDay.getDay());
        const isHoliday = holidayDates.some(
          (holiday) => holiday.toISOString().split("T")[0] === currentDateStr
        );
        const isFutureDay = currentDay > today;

        // If it's a workday (not weekend, not holiday) and not in the future
        if (!isWeekend && !isHoliday && !isFutureDay) {
          // And not a worked day and not a leave day
          const isWorked = uniqueWorkedDates.some(
            (date) => date.split("T")[0] === currentDateStr
          );
          const isLeave = leaveDates.some(
            (date) => date.split("T")[0] === currentDateStr
          );

          if (!isWorked && !isLeave) {
            absentDates.push(currentDay.toISOString());
          }
        }

        // Move to next day
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
          daysOnLeave: leaveDates.length,
          daysAbsent: absentDates.length,
          totalWorkDays,
          workedDates: uniqueWorkedDates,
          leaveDates,
          leaveInfo,
          absentDates,
        },
      };
    }),
});
