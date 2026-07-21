import type {
  Attendance,
  ContractType,
  User,
  WorkSegment,
} from "@prisma/client";
import type { Attendance as AttendanceState } from "./user.store";

export interface TrpcUser extends Omit<
  User,
  "contracts" | "createdAt" | "updatedAt"
> {
  contracts: {
    contractType: ContractType;
    startDate: string;
    endDate: string | null;
    reviewDate: string;
    salaryInBDT: number;
    createdAt: string | null;
    updatedAt: string | null;
  }[];
  createdAt: string;
  updatedAt: string;
}

interface TrpcWorkSegments extends Omit<WorkSegment, "start" | "end"> {
  start: string;
  end: string | null;
}

export interface TrpcAttendance extends Omit<
  Attendance,
  "workSegments" | "date"
> {
  date: string;
  workSegments: TrpcWorkSegments[];
}

export interface TrpcUserWithAttendance extends TrpcUser {
  attendance?: TrpcAttendance;
}

export const convertTrpcAttendanceToDbAttendance = (
  attendance: TrpcAttendance,
): Attendance => {
  return {
    ...attendance,
    date: new Date(attendance.date),
    workSegments: attendance.workSegments.map((ws) => ({
      ...ws,
      start: new Date(ws.start),
      end: ws.end ? new Date(ws.end) : null,
      length_ms: ws.length_ms
        ? ws.length_ms
        : ws.end
          ? new Date(ws.end).getTime() - new Date(ws.start).getTime()
          : null,
    })),
  };
};

export const convertTrpcUserToDbUser = (user: TrpcUser): User => {
  return {
    ...user,
    contracts: user.contracts.map((contract) => ({
      ...contract,
      startDate: new Date(contract.startDate),
      endDate: contract.endDate ? new Date(contract.endDate) : null,
      reviewDate: new Date(contract.reviewDate),
      createdAt: contract.createdAt ? new Date(contract.createdAt) : null,
      updatedAt: contract.updatedAt ? new Date(contract.updatedAt) : null,
    })),
    createdAt: new Date(user.createdAt),
    updatedAt: new Date(user.updatedAt),
  };
};

export const calculateTotalWorkMs = (segments: WorkSegment[]): number => {
  return segments.reduce((total, segment) => {
    if (segment.length_ms) return total + segment.length_ms;
    const end = segment.end ?? new Date();
    return total + (end.getTime() - segment.start.getTime());
  }, 0);
};

export interface TimeSegment {
  id: number;
  start: Date;
  end?: Date;
  length_ms: number | null;
  type: "work" | "break";
  channel?: string;
}

export function generateTimeSegments(
  attendance: AttendanceState,
): TimeSegment[] {
  let id = 1;
  return attendance.workSegments.map((ws) => ({
    id: id++,
    start: ws.start,
    end: ws.end ?? undefined,
    length_ms: ws.length_ms,
    type: "work" as const,
    channel: ws.project,
  }));
}

import type {
  AttendanceSummary,
  TrpcAttendanceSummary,
} from "../types/attendance";

export function convertTrpcAttendanceSummaryToAttendanceSummary(
  summary: TrpcAttendanceSummary,
): AttendanceSummary {
  return {
    timeRange: {
      startDate: new Date(summary.timeRange.startDate),
      endDate: new Date(summary.timeRange.endDate),
    },
    unit: summary.unit,
    value: summary.value,
    stats: {
      ...summary.stats,
      workedDates: summary.stats.workedDates.map((date) => new Date(date)),
      absentDates: summary.stats.absentDates.map((date) => new Date(date)),
    },
  };
}
