import type { Contract } from "@prisma/client";
import type { WorkSegmentBreakdownRow } from "../../../db";
import { getStartOfDay, getEndOfDay } from "../../../db";

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

// e.g. 8/3/2026
const formatCsvDate = (date: Date): string => date.toLocaleDateString("en-US");

// e.g. 12:20:00 AM
const formatCsvTime = (date: Date): string =>
  date.toLocaleTimeString("en-US", { hour12: true });

// Duration as H:MM:SS (e.g. 3:29:49), matching the source timesheet format.
const formatHoursSpent = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
};

interface WorkBreakdownCsv {
  csv: string;
  totalMs: number;
  totalEarnings: number;
  employeeCount: number;
}

/**
 * Build the task-wise breakdown CSV shared by the per-employee `/report` and the
 * per-project `/project report breakdown` outputs: one row per work segment with
 * Date, [Employee,] Project, Task Description, Start/End Time, Hours Spent and
 * Earnings (hours × the employee's latest contract rate; blank when no contract).
 * Open segments have their End Time shown as `(estimated)`. Ends with a TOTAL row.
 *
 * `includeEmployeeColumn` adds an Employee column for the project view where rows
 * span multiple people; the single-employee view omits it.
 */
export const buildWorkBreakdownCsv = (
  rows: WorkSegmentBreakdownRow[],
  { includeEmployeeColumn }: { includeEmployeeColumn: boolean },
): WorkBreakdownCsv => {
  const header = [
    "Date",
    ...(includeEmployeeColumn ? ["Employee"] : []),
    "Project",
    "Task Description",
    "Start Time",
    "End Time",
    "Hours Spent",
    "Earnings",
  ];
  const csvRows: string[][] = [header];

  let totalMs = 0;
  let totalEarnings = 0;
  const employeeIds = new Set<string>();

  for (const row of rows) {
    employeeIds.add(row.user.id);
    totalMs += row.ms;

    const rate = getLatestContract(row.user.contracts)?.salaryInBDT;
    const earnings =
      rate !== undefined ? (row.ms / MS_PER_HOUR) * rate : undefined;
    if (earnings !== undefined) totalEarnings += earnings;

    const endCell = row.estimated
      ? "(estimated)"
      : row.end
        ? formatCsvTime(row.end)
        : "";

    csvRows.push([
      formatCsvDate(row.date),
      ...(includeEmployeeColumn ? [row.user.name] : []),
      row.project,
      row.description ?? "",
      formatCsvTime(row.start),
      endCell,
      formatHoursSpent(row.ms),
      earnings !== undefined ? earnings.toFixed(2) : "",
    ]);
  }

  // TOTAL row: label in the first cell, totals aligned under the last two
  // columns (Hours Spent, Earnings); the columns in between are left blank.
  const leadingBlanks = header.length - 3;
  csvRows.push([
    "TOTAL",
    ...Array<string>(leadingBlanks).fill(""),
    formatHoursSpent(totalMs),
    totalEarnings.toFixed(2),
  ]);

  return {
    csv: rowsToCsv(csvRows),
    totalMs,
    totalEarnings,
    employeeCount: employeeIds.size,
  };
};

export interface MonthRange {
  rangeStart: Date;
  rangeEnd: Date;
  monthLabel: string;
  monthKey: string;
}

/**
 * Resolve an optional `YYYY-MM` option to a calendar-month range (defaulting to
 * the current month). Returns `{ error }` for a malformed value so the caller can
 * reply with a friendly message. Values normally come from `recentMonthChoices`
 * autocomplete, but Discord still allows free-typed input.
 */
export const resolveMonthRange = (
  monthOption?: string | null,
): MonthRange | { error: string } => {
  let year: number;
  let monthIndex: number; // 0-based

  if (monthOption) {
    const match = /^(\d{4})-(\d{2})$/.exec(monthOption.trim());
    if (!match) {
      return {
        error:
          "❌ Invalid month. Pick one of the suggestions or use `YYYY-MM` (e.g. `2026-08`).",
      };
    }
    year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) {
      return { error: "❌ Invalid month. The month part must be 01–12." };
    }
    monthIndex = month - 1;
  } else {
    const now = new Date();
    year = now.getFullYear();
    monthIndex = now.getMonth();
  }

  return {
    rangeStart: getStartOfDay(new Date(year, monthIndex, 1)),
    rangeEnd: getEndOfDay(new Date(year, monthIndex + 1, 0)),
    monthLabel: new Date(year, monthIndex, 1).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    }),
    monthKey: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
  };
};

/**
 * Autocomplete choices for a `month` option: the current month and the previous
 * `count - 1` months, newest first. Pure date math — no DB access.
 */
export const recentMonthChoices = (
  count = 12,
): { name: string; value: string }[] => {
  const now = new Date();
  const choices: { name: string; value: string }[] = [];
  for (let i = 0; i < count; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    choices.push({
      name: date.toLocaleString("en-US", { month: "long", year: "numeric" }),
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
    });
  }
  return choices;
};
