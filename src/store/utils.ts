import {
  Attendance,
  Break,
  ContractType,
  User,
  WorkSegment,
} from "@prisma/client";
import { Attendance as AttendanceState } from "./user.store";

export interface TrpcUser
  extends Omit<User, "leaves" | "contracts" | "createdAt" | "updatedAt"> {
  leaves: {
    remainingLeaveCount: number;
    resetAt: string;
  }[];
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

interface TrpcBreaks extends Omit<Break, "start" | "end"> {
  start: string;
  end: string | null;
}

interface TrpcWorkSegments extends Omit<WorkSegment, "start" | "end"> {
  start: string;
  end: string | null;
}

export interface TrpcAttendance
  extends Omit<Attendance, "breaks" | "login" | "logout" | "workSegments"> {
  breaks: TrpcBreaks[];
  login: string;
  logout: string | null;
  workSegments: TrpcWorkSegments[];
}

export interface TrpcUserWithAttendance extends TrpcUser {
  attendance?: TrpcAttendance;
}

const setTimeToEndOfDayInBD = (date: Date): Date => {
  const dateCopy = new Date(date);
  dateCopy.setDate(dateCopy.getDate() + 1);
  dateCopy.setUTCHours(17, 59, 0, 0);
  return dateCopy;
};

export const convertTrpcAttendanceToDbAttendance = (
  attendance: TrpcAttendance
): Attendance => {
  // Handle case where logout was not triggered for the day
  const endOfDay = setTimeToEndOfDayInBD(new Date(attendance.login));
  const shouldHaveLoggedOut = new Date().getTime() > endOfDay.getTime();
  const convertTrpcSegmentToSegment = <T extends Break | WorkSegment>(
    item: TrpcBreaks | TrpcWorkSegments
  ): T => {
    return {
      ...item,
      start: new Date(item.start),
      length_ms: item.length_ms
        ? item.length_ms
        : item.end
        ? new Date(item.end).getTime() - new Date(item.start).getTime()
        : shouldHaveLoggedOut
        ? new Date(endOfDay).getTime() - new Date(item.start).getTime()
        : null,
      end: item.end
        ? new Date(item.end)
        : shouldHaveLoggedOut
        ? new Date(endOfDay)
        : null,
    } as T;
  };

  return {
    ...attendance,
    breaks: attendance.breaks.map(convertTrpcSegmentToSegment<Break>),
    workSegments: attendance.workSegments.map(
      convertTrpcSegmentToSegment<WorkSegment>
    ),
    login: new Date(attendance.login),
    logout: attendance.logout
      ? new Date(attendance.logout)
      : shouldHaveLoggedOut
      ? new Date(endOfDay)
      : null,
  };
};

export const convertTrpcUserToDbUser = (user: TrpcUser): User => {
  return {
    ...user,
    leaves: user.leaves.map((leave) => ({
      ...leave,
      resetAt: new Date(leave.resetAt),
    })),
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

const getEffectiveEndTime = (segment: WorkSegment | Break): Date => {
  return segment.end || new Date();
};

export const calculateMsWorkedOrBreaksTaken = (
  segments: (WorkSegment | Break)[]
): number => {
  return segments.reduce((total, segment) => {
    if (segment.length_ms) {
      return total + segment.length_ms;
    } else {
      const effectiveEndTime = getEffectiveEndTime(segment);
      const segmentTime = effectiveEndTime.getTime() - segment.start.getTime();
      return total + segmentTime;
    }
  }, 0);
};

export interface TimeSegment {
  id: number;
  start: Date;
  end?: Date; // Make end optional
  length_ms: number | null;
  type: "work" | "break";
  channel?: string;
}

/**
 * Generates a list of TimeSegments (work and break).
 * 1) If workSegments exist and are non-empty, simply transform them
 *    plus the breaks into a combined timeline.
 * 2) Otherwise (older DB records), fall back to the original logic
 *    where we infer "work" segments from the intervals between breaks.
 */
export function generateTimeSegments(
  attendance: AttendanceState
): TimeSegment[] {
  return generateTimeSegmentPreState({
    breaks: attendance.breaks,
    workSegments: attendance.workSegments,
    login: attendance.loggedInTime || null,
    logout: attendance.loggedOutTime || null,
  });
}
interface AttendanceWithoutLoginMaybe
  extends Pick<Attendance, "logout" | "breaks" | "workSegments"> {
  login: Date | null;
}
export function generateTimeSegmentPreState(
  attendance: AttendanceWithoutLoginMaybe
): TimeSegment[] {
  const { breaks, workSegments, login, logout } = attendance;
  const timeSegments: TimeSegment[] = [];
  let id = 1;
  // If workSegments exist and contain entries, use them directly
  if (workSegments && workSegments.length > 0) {
    // 1) Transform each workSegment into a TimeSegment of type 'work'
    const mappedWorkSegments: TimeSegment[] = workSegments.map((ws) => ({
      id: 0, // temporary placeholder; will assign later
      start: ws.start,
      end: ws.end ?? undefined,
      length_ms: ws.length_ms,
      type: "work",
      channel: ws.project,
    }));

    // 2) Transform each break into a TimeSegment of type 'break'
    const mappedBreakSegments: TimeSegment[] = breaks.map((b) => ({
      id: 0, // temporary placeholder; will assign later
      start: b.start,
      end: b.end ?? undefined,
      length_ms: b.length_ms,
      type: "break",
    }));

    // 3) Combine & sort by start time
    const combined = [...mappedWorkSegments, ...mappedBreakSegments].sort(
      (a, b) => a.start.getTime() - b.start.getTime()
    );

    // 4) Assign IDs in chronological order
    combined.forEach((segment) => {
      segment.id = id++;
    });

    return combined;
  }

  // Otherwise, OLD LOGIC for older records (no workSegments):
  // -------------------------------------------------------------------
  // If there's no loggedInTime, just return an empty array
  if (!login) {
    return timeSegments;
  }

  // We'll keep track of the "current work start time" in this variable
  let currentTime: Date | null = login;

  // Loop through each break
  for (const breakTime of breaks) {
    // 1) If currentTime is before breakTime.start, create a Work segment
    if (currentTime && breakTime.start && currentTime < breakTime.start) {
      timeSegments.push({
        id: id++,
        start: currentTime,
        end: breakTime.start,
        length_ms: breakTime.start.getTime() - currentTime.getTime(),
        type: "work",
        channel: "Working",
      });
    }

    // 2) Create the Break segment
    timeSegments.push({
      id: id++,
      start: breakTime.start,
      end: breakTime.end ?? undefined,
      length_ms: breakTime.length_ms,
      type: "break",
    });

    // 3) Update currentTime to the end of this break (if it exists).
    //    If breakTime.end is null, the break is ongoing -> stop generating further segments
    if (breakTime.end) {
      currentTime = breakTime.end;
    } else {
      currentTime = null;
      break;
    }
  }

  // 4) If currentTime is still set after all breaks,
  //    add a final work segment up to loggedOutTime (or open-ended).
  if (currentTime) {
    timeSegments.push({
      id: id++,
      start: currentTime,
      end: logout ?? undefined,
      length_ms: logout ? logout.getTime() - currentTime.getTime() : null,
      type: "work",
      channel: "Working",
    });
  }

  return timeSegments;
}

// Add this function to your existing utils.ts file
import { AttendanceSummary, TrpcAttendanceSummary } from "../types/attendance";

export function convertTrpcAttendanceSummaryToAttendanceSummary(
  summary: TrpcAttendanceSummary
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
      leaveDates: summary.stats.leaveDates.map((date) => new Date(date)),
      leaveInfo: summary.stats.leaveInfo.map((info) => ({
        date: new Date(info.date),
        reason: info.reason,
        approved: info.approved,
        approvedBy: info.approvedBy,
        approvedDate: info.approvedDate
          ? new Date(info.approvedDate)
          : undefined,
      })),
      absentDates: summary.stats.absentDates.map((date) => new Date(date)),
    },
  };
}
