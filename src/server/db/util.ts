/**
 * Normalize a date to UTC to ensure consistent date handling across timezones
 * Sets the time to end of day (23:59:59.999) in the local timezone
 */
export function normalizeDate(date: Date): Date {
  const timeZoneOffsetHours = new Date().getTimezoneOffset() / 60;

  // Preserve the same day in UTC time
  return new Date(
    Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate(),
      23 + timeZoneOffsetHours,
      59,
      59,
      999
    )
  );
}

export function getStartOfDay(date: Date): Date {
  const normalizedDate = normalizeDate(date);
  return new Date(
    normalizedDate.getFullYear(),
    normalizedDate.getMonth(),
    normalizedDate.getDate(),
    0,
    0,
    0,
    0
  );
}

export function getEndOfDay(date: Date): Date {
  const normalizedDate = normalizeDate(date);
  return new Date(
    normalizedDate.getFullYear(),
    normalizedDate.getMonth(),
    normalizedDate.getDate(),
    23,
    59,
    59,
    999
  );
}

export const ONE_DAY_IN_MS = 24 * 60 * 60 * 1000;
export const ONE_MONTH_IN_MS = 30 * ONE_DAY_IN_MS;