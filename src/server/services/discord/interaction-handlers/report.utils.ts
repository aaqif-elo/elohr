import type { Contract } from "@prisma/client";

export const MS_PER_HOUR = 3600000;

// The user's most recent contract by start date holds their current rate.
export const getLatestContract = (
  contracts: Contract[]
): Contract | undefined => {
  if (!contracts.length) return undefined;
  return [...contracts].sort(
    (a, b) => b.startDate.getTime() - a.startDate.getTime()
  )[0];
};

export const formatBDT = (amount: number): string =>
  `৳${amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

// Quote a CSV field only when it contains a delimiter, quote, or newline.
const csvEscape = (value: string): string =>
  /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

// Serialize rows to CSV, prefixed with a UTF-8 BOM so Excel renders non-ASCII
// names (e.g. Bengali) correctly.
export const rowsToCsv = (rows: string[][]): string =>
  "﻿" + rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
