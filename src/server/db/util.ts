/**
 * Calculates the start of the day in the local timezone.
 * Note: This function intentionally uses local timezone values (date.getFullYear(), etc.)
 * to preserve the local date context. It does not normalize to UTC.
 */
export function getStartOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    0,
    0,
    0,
    0
  );
}

export function getEndOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999
  );
}

export const ONE_MINUTE_IN_MS = 60 * 1000;
export const ONE_DAY_IN_MS = 24 * 60 * ONE_MINUTE_IN_MS;
export const ONE_MONTH_IN_MS = 30 * ONE_DAY_IN_MS;

export const getErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  } else if (typeof error === "string") {
    return error;
  } else {
    return "An unknown error occurred";
  }
};
