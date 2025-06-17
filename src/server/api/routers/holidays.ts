import {
  adminProcedure,
  authProcedure,
  createTRPCRouter,
  publicProcedure,
} from "../trpc";
import {
  object,
  string,
  isoTimestamp,
  pipe,
  parseAsync,
  optional,
} from "valibot";
import { HolidayType } from "@prisma/client";
import {
  convertToHoliday,
  convertToWorkday,
  getHolidays,
  getNextHoliday,
  isHoliday,
  markUpcomingHolidaysAsAnnounced,
  shiftHoliday,
} from "../../db";

export const holidaysRouter = createTRPCRouter({
  // Convert a workday to a holiday (admin only)
  convertToHoliday: adminProcedure
    .input((data) =>
      parseAsync(
        object({
          date: pipe(string(), isoTimestamp()),
          name: string(),
          description: optional(string()),
          type: optional(string()),
        }),
        data
      )
    )
    .mutation(async (opts) => {
      const date = new Date(opts.input.date);
      const name = opts.input.name;
      const description = opts.input.description;

      // Parse holiday type or use CUSTOM as default
      let type: HolidayType = HolidayType.INTERNAL;
      if (
        opts.input.type &&
        Object.values(HolidayType).includes(opts.input.type as HolidayType)
      ) {
        type = opts.input.type as HolidayType;
      }

      return convertToHoliday(date, name, type, description);
    }),

  // Convert a holiday back to a workday (admin only)
  convertToWorkday: adminProcedure
    .input((data) =>
      parseAsync(
        object({
          date: pipe(string(), isoTimestamp()),
        }),
        data
      )
    )
    .mutation(async (opts) => {
      const date = new Date(opts.input.date);
      return convertToWorkday(date);
    }),

  // Shift a holiday to a new date (admin only)
  shiftHoliday: adminProcedure
    .input((data) =>
      parseAsync(
        object({
          originalDate: pipe(string(), isoTimestamp()),
          newDate: pipe(string(), isoTimestamp()),
        }),
        data
      )
    )
    .mutation(async (opts) => {
      const originalDate = new Date(opts.input.originalDate);
      const newDate = new Date(opts.input.newDate);
      return shiftHoliday(originalDate, newDate);
    }),
  getHolidaysForYear: authProcedure
    .input((data) =>
      parseAsync(
        object({
          year: optional(string()),
        }),
        data
      )
    )
    .query(async (opts) => {
      // Get the year from input or use current year
      const yearString = opts.input.year || new Date().getFullYear().toString();
      const year = parseInt(yearString);

      // Create a date object for January 1st of the requested year
      const date = new Date(year, 0, 1);

      // Get holidays for the year
      return getHolidays(date, "year");
    }),
  getNextHoliday: publicProcedure
    .input((data) =>
      parseAsync(
        object({
          date: optional(string()),
        }),
        data
      )
    )
    .query(async (opts) => {
      // Get the date from input or use current date
      const date = opts.input.date ? new Date(opts.input.date) : new Date();

      // Get the next holiday
      return getNextHoliday(date);
    }),
  isHoliday: publicProcedure
    .input((data) =>
      parseAsync(
        object({
          date: optional(string()),
        }),
        data
      )
    )
    .query(async (opts) => {
      // Get the date from input or use current date
      const date = opts.input.date ? new Date(opts.input.date) : new Date();

      // Check if it's a holiday
      const holiday = await isHoliday(date);

      // Return boolean and holiday info if it exists
      return {
        isHoliday: !!holiday,
        holiday: holiday,
      };
    }),

  markHolidayAsAnnounced: adminProcedure
    .input((data) =>
      parseAsync(
        object({
          date: pipe(string(), isoTimestamp()),
        }),
        data
      )
    )
    .mutation(async (opts) => {
      const date = new Date(opts.input.date);
      const count = await markUpcomingHolidaysAsAnnounced(date);
      return count;
    }),
});
