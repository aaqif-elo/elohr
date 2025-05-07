import { Holiday, HolidayType, Prisma } from "@prisma/client";
import { db, normalizeDate } from ".";

// Add a new holiday
async function addHoliday(
  name: string,
  originalDate: Date,
  type: HolidayType,
  description?: string,
  overridenDate?: Date
): Promise<Holiday> {
  const normalizedOriginalDate = normalizeDate(originalDate);
  const normalizedOverridenDate = overridenDate
    ? normalizeDate(overridenDate)
    : undefined;

  const dayOfWeek = normalizedOriginalDate.getDay();
  const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // 6 is Saturday, 5 is Friday

  return db.holiday.create({
    data: {
      name,
      originalDate: normalizedOriginalDate,
      overridenDate: normalizedOverridenDate,
      description,
      type,
      dayOfWeek,
      isWeekend,
    },
  });
}

// Override an existing holiday
async function overrideHoliday(
  id: string,
  overridenDate: Date
): Promise<Holiday> {
  const normalizedOverridenDate = normalizeDate(overridenDate);

  return db.holiday.update({
    where: { id },
    data: {
      overridenDate: normalizedOverridenDate,
    },
  });
}

// Cache to track which years have been populated
const checkedYears: Record<string, boolean> = {};

// Ensure a specific year's holiday data is populated
async function ensureYearPopulated(year: string): Promise<void> {
  if (!checkedYears[year]) {
    try {
      // Check if any holidays already exist for this year
      const startDate = normalizeDate(new Date(parseInt(year), 0, 1));
      const endDate = normalizeDate(new Date(parseInt(year), 11, 31));

      const existingHolidays = await db.holiday.count({
        where: {
          originalDate: {
            gte: startDate,
            lte: endDate,
          },
        },
      });

      if (existingHolidays === 0) {
        // Fetch and import holidays for this year
        const holidays = await getHolidayInfoFromOfficeHolidaysDotCom(year);
        await importHolidays(holidays);
      }

      // Mark year as checked regardless of outcome
      checkedYears[year] = true;
    } catch (error) {
      console.error(`Failed to populate holidays for year ${year}:`, error);
      // Don't mark as checked if there was an error, so we can retry later
    }
  }
}

// Get all holidays for a custom date range
export async function getHolidaysForDateRange(
  startDate: Date,
  endDate: Date
): Promise<Holiday[]> {
  // Ensure all years in the range are populated
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();

  // Populate each year in the range if needed
  const populationPromises: Promise<void>[] = [];
  for (let year = startYear; year <= endYear; year++) {
    populationPromises.push(ensureYearPopulated(year.toString()));
  }

  // Wait for all years to be populated
  await Promise.all(populationPromises);

  // Now query the database as before
  return db.holiday.findMany({
    where: {
      OR: [
        {
          originalDate: {
            gte: startDate,
            lte: endDate,
          },
        },
        {
          overridenDate: {
            gte: startDate,
            lte: endDate,
          },
        },
      ],
      isActive: true,
    },
    orderBy: [
      {
        overridenDate: Prisma.SortOrder.asc,
      },
      {
        originalDate: Prisma.SortOrder.asc,
      },
    ],
  });
}

// Soft delete - mark a holiday as inactive
async function deactivateHoliday(id: string): Promise<Holiday> {
  return db.holiday.update({
    where: { id },
    data: {
      isActive: false,
    },
  });
}

// Mark a holiday as announced
export async function markHolidayAsAnnounced(id: string): Promise<Holiday> {
  return db.holiday.update({
    where: { id },
    data: {
      announcementSent: true,
    },
  });
}

interface IHolidayObj {
  name: string;
  date: Date;
  type: HolidayType;
  description?: string;
}

// Import holidays from external source (helper function)
async function importHolidays(holidays: IHolidayObj[]): Promise<Holiday[]> {
  const results: Holiday[] = [];

  for (const holiday of holidays) {
    // Normalize the date
    const normalizedDate = normalizeDate(holiday.date);

    // Check if holiday already exists
    const startOfDay = new Date(normalizedDate);
    startOfDay.setHours(0, 0, 0, 0);

    const existingHoliday = await db.holiday.findFirst({
      where: {
        name: holiday.name,
        originalDate: {
          gte: startOfDay,
          lte: normalizedDate,
        },
      },
    });

    if (!existingHoliday) {
      const newHoliday = await addHoliday(
        holiday.name,
        normalizedDate,
        holiday.type,
        holiday.description
      );
      results.push(newHoliday);
    }
  }

  return results;
}

import { load } from "cheerio";
import axios from "axios";

async function getHolidayInfoFromOfficeHolidaysDotCom(
  year: string
): Promise<IHolidayObj[]> {
  const holidayListPage = await axios.get(
    `https://www.officeholidays.com/countries/bangladesh/${year}`,
    {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/105.0.0.0 Safari/537.36",
      },
    }
  );

  const body = await holidayListPage.data;
  const $ = load(body);

  const holidayList: IHolidayObj[] = [];
  let date: Date,
    name: string,
    description: string,
    shouldAdd = false;

  $("table.country-table > tbody > tr").each((i, elm) => {
    $(elm)
      .find("td")
      .each((j, innerTableCell) => {
        if (j === 1) {
          const start = $(innerTableCell).children("time").attr("datetime");
          if (!start) return;
          date = new Date(new Date(start).setHours(0, 0, 0, 0));
        } else if (j === 2) {
          name = $(innerTableCell).text().trim();
        } else if (j === 3) {
          const type = $(innerTableCell).text().trim();
          if (type === "National Holiday") {
            shouldAdd = true;
          }
        } else if (j === 4) {
          if (shouldAdd) {
            description = $(innerTableCell).text().trim();
            holidayList.push({
              name,
              date,
              type: HolidayType.NATIONAL,
              description,
            });
          }
          shouldAdd = false;
        }
      });
  });
  return holidayList;
}

// Define the range type
type HolidayRange = "week" | "month" | "year";

/**
 * Get holidays based on a date and range type
 * @param date The reference date
 * @param range The range type ('week', 'month', or 'year')
 * @returns Holidays within the specified range
 */
export async function getHolidays(
  date: Date,
  range: HolidayRange
): Promise<Holiday[]> {
  let startDate: Date;
  let endDate: Date;

  switch (range) {
    case "week":
      // Get the start of the week (Sunday)
      startDate = new Date(date);
      startDate.setDate(date.getDate() - date.getDay());
      startDate = normalizeDate(startDate);
      startDate.setHours(0, 0, 0, 0); // Beginning of day

      // Get the end of the week (Saturday)
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate = normalizeDate(endDate); // Already end of day
      break;

    case "month":
      // Get the start of the month
      startDate = new Date(date);
      startDate.setDate(1);
      startDate = normalizeDate(startDate);
      startDate.setHours(0, 0, 0, 0); // Beginning of day

      // Get the end of the month
      endDate = normalizeDate(
        new Date(date.getFullYear(), date.getMonth() + 1, 0)
      );
      break;

    case "year":
      // Get the start of the year
      startDate = normalizeDate(new Date(date.getFullYear(), 0, 1));
      startDate.setHours(0, 0, 0, 0); // Beginning of day

      // Get the end of the year
      endDate = normalizeDate(new Date(date.getFullYear(), 11, 31));
      break;
  }

  return getHolidaysForDateRange(startDate, endDate);
}

/**
 * Convert a regular workday to a holiday
 */
export async function convertToHoliday(
  date: Date,
  name: string,
  type: HolidayType = HolidayType.ELO,
  description?: string
) {
  const normalizedDate = normalizeDate(date);

  // Check for existing holiday
  const existingHoliday = await db.holiday.findFirst({
    where: {
      OR: [{ originalDate: normalizedDate }, { overridenDate: normalizedDate }],
      isActive: true,
    },
  });

  if (existingHoliday) {
    throw new Error(
      `A holiday already exists on ${normalizedDate.toDateString()}`
    );
  }

  // Create the new holiday
  return addHoliday(name, normalizedDate, type, description);
}

/**
 * Convert a holiday back to a regular workday
 */
export async function convertToWorkday(date: Date): Promise<Holiday> {
  const normalizedDate = normalizeDate(date);
  const startOfDay = new Date(normalizedDate);
  startOfDay.setHours(0, 0, 0, 0);

  // Find the holiday on this date
  const holiday = await db.holiday.findFirst({
    where: {
      OR: [
        {
          originalDate: {
            gte: startOfDay,
            lte: normalizedDate,
          },
          NOT: {
            overridenDate: {
              isSet: true,
            },
          },
        },
        {
          overridenDate: {
            gte: startOfDay,
            lte: normalizedDate,
          },
        },
      ],
      isActive: true,
    },
  });

  if (!holiday) {
    throw new Error(`No holiday found on ${normalizedDate.toDateString()}`);
  }

  // Deactivate the holiday rather than deleting it
  return deactivateHoliday(holiday.id);
}

/**
 * Shift a holiday from one date to another
 */
export async function shiftHoliday(
  originalDate: Date,
  newDate: Date
): Promise<Holiday> {
  const normalizedOriginalDate = normalizeDate(originalDate);
  const normalizedNewDate = normalizeDate(newDate);

  const startOfDay = new Date(normalizedOriginalDate);
  startOfDay.setHours(0, 0, 0, 0);

  // Find the holiday on the original date
  const holiday = await db.holiday.findFirst({
    where: {
      OR: [
        {
          originalDate: {
            gte: startOfDay,
            lte: normalizedOriginalDate,
          },
          NOT: {
            overridenDate: {
              isSet: true,
            },
          },
        },
        {
          overridenDate: {
            gte: startOfDay,
            lte: normalizedOriginalDate,
          },
        },
      ],
      isActive: true,
    },
  });

  if (!holiday) {
    throw new Error(
      `No holiday found on ${normalizedOriginalDate.toDateString()}`
    );
  }

  // Check if there's already a holiday on the target date
  const existingHolidayOnTarget = await db.holiday.findFirst({
    where: {
      OR: [
        { originalDate: normalizedNewDate },
        { overridenDate: normalizedNewDate },
      ],
      isActive: true,
      id: { not: holiday.id }, // Exclude the holiday we're moving
    },
  });

  if (existingHolidayOnTarget) {
    throw new Error(
      `A holiday already exists on ${normalizedNewDate.toDateString()}`
    );
  }

  // Update the holiday with the new date
  return overrideHoliday(holiday.id, normalizedNewDate);
}

/**
 * Represents a chain of consecutive holidays and weekends
 */
export interface HolidayChain {
  startDate: Date;
  endDate: Date;
  holidays: string[]; // List of unique holiday names in chronological order
}

/**
 * Get the next holiday period, including any chained holidays and weekends
 * @param fromDate The date to start looking from
 * @returns Information about the next holiday period or null if none found
 */
export async function getNextHoliday(
  fromDate: Date = new Date()
): Promise<HolidayChain | null> {
  // Normalize the fromDate to ensure consistent comparison
  const normalizedFromDate = normalizeDate(fromDate);
  normalizedFromDate.setHours(0, 0, 0, 0); // Start of day

  // Ensure current and next year are populated
  const currentYear = normalizedFromDate.getFullYear();
  await ensureYearPopulated(currentYear.toString());
  await ensureYearPopulated((currentYear + 1).toString());

  // Find the next holiday in the database
  const nextHolidays = await db.holiday.findMany({
    where: {
      OR: [
        {
          originalDate: {
            gte: normalizedFromDate,
          },
          NOT: {
            overridenDate: {
              isSet: true,
            },
          },
          isActive: true,
          isWeekend: false, // Filter out holidays on weekends
          announcementSent: false, // Exclude holidays that have been announced
        },
        {
          overridenDate: {
            gte: normalizedFromDate,
          },
          isActive: true,
          isWeekend: false, // Filter out holidays on weekends
          announcementSent: false, // Exclude holidays that have been announced
        },
      ],
    },
    orderBy: [
      {
        originalDate: Prisma.SortOrder.asc,
      },
      {
        overridenDate: Prisma.SortOrder.asc,
      },
    ],
  });

  const nextHoliday = nextHolidays[0];

  if (!nextHoliday) return null;

  // Determine the holiday's effective date
  const holidayDate = nextHoliday.overridenDate || nextHoliday.originalDate;

  // For this holiday, check if it's part of a longer chain
  let startDate = new Date(holidayDate);
  let endDate = new Date(holidayDate);
  let currentDate = new Date(holidayDate);

  // Collection of raw holidays for sorting purposes
  const rawHolidays: Holiday[] = [nextHoliday];

  // Look forward until we find a working day
  while (true) {
    currentDate = new Date(currentDate);
    currentDate.setDate(currentDate.getDate() + 1);

    // Check if this is a weekend
    const dayOfWeek = currentDate.getDay();
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6; // 5=Friday, 6=Saturday

    if (isWeekend) {
      endDate = new Date(currentDate);
      continue;
    }

    // Check if this is a holiday
    const holidayOnCurrentDate = await db.holiday.findFirst({
      where: {
        OR: [
          {
            originalDate: {
              equals: currentDate,
            },
            NOT: {
              overridenDate: {
                isSet: true,
              },
            },
            isActive: true,
          },
          {
            overridenDate: {
              equals: currentDate,
            },
            isActive: true,
          },
        ],
      },
    });

    if (holidayOnCurrentDate) {
      // Extend the chain
      endDate = new Date(currentDate);

      // Add holiday to the list if present
      if (holidayOnCurrentDate) {
        rawHolidays.push(holidayOnCurrentDate);
      }
    } else {
      // Chain is broken - a working day was found
      break;
    }
  }

  // Sort holidays by date
  rawHolidays.sort((a, b) => {
    const dateA = a.overridenDate || a.originalDate;
    const dateB = b.overridenDate || b.originalDate;
    return dateA.getTime() - dateB.getTime();
  });

  // Extract unique holiday names while preserving order
  const uniqueHolidays: string[] = [];
  const seenHolidays = new Set<string>();

  for (const holiday of rawHolidays) {
    if (!seenHolidays.has(holiday.name)) {
      seenHolidays.add(holiday.name);
      uniqueHolidays.push(holiday.name);
    }
  }

  // If it is a chained holiday and the holiday starts at the beginning of the week, adjust the start date
  if (startDate.getDay() === 0 && rawHolidays.length > 1) {
    startDate.setDate(startDate.getDate() - 2);
  }

  return {
    startDate,
    endDate,
    holidays: uniqueHolidays,
  };
}

/**
 * Check if a given date is a holiday
 * @param date The date to check
 * @returns Information about the holiday if it exists, otherwise null
 */
export async function isHoliday(
  date: Date = new Date()
): Promise<Holiday | null> {
  // Create start and end bounds for the given date (ignoring time)
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);

  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // Check if the date is a holiday
  const holiday = await db.holiday.findFirst({
    where: {
      OR: [
        {
          // Check against original date if it hasn't been overridden
          originalDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
          NOT: {
            overridenDate: {
              isSet: true,
            },
          },
          isActive: true,
        },
        {
          // Check against overridden date if it exists
          overridenDate: {
            gte: startOfDay,
            lte: endOfDay,
          },
          isActive: true,
        },
      ],
    },
  });

  return holiday;
}
