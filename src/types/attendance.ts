export type TimeUnit = 'week' | 'month' | 'quarter' | 'year';

export interface LeaveInfo {
  date: Date;
  reason?: string;
  approved?: boolean;
  approvedBy?: string;
  approvedDate?: Date;
}

export interface AttendanceSummary {
  timeRange: {
    startDate: Date;
    endDate: Date;
  };
  unit: TimeUnit;
  value: string | number; // Week number, month name, quarter (Q1-Q4), or year
  stats: {
    daysWorked: number;
    daysOnLeave: number;
    daysAbsent: number;
    totalWorkDays: number; // Total working days (excluding weekends and holidays)
    // New date arrays
    workedDates: Date[];
    leaveDates: Date[]; // Keep this for backward compatibility
    leaveInfo: LeaveInfo[]; // New field with detailed leave information
    absentDates: Date[];
  };
}

// Add this type for TRPC responses
export interface TrpcLeaveInfo {
  date: string;
  reason?: string;
  approved?: boolean;
  approvedBy?: string;
  approvedDate?: string;
}

export interface TrpcAttendanceSummary {
  timeRange: {
    startDate: string;
    endDate: string;
  };
  unit: TimeUnit;
  value: string | number;
  stats: {
    daysWorked: number;
    daysOnLeave: number;
    daysAbsent: number;
    totalWorkDays: number;
    // New date arrays (as ISO strings)
    workedDates: string[];
    leaveDates: string[];
    leaveInfo: TrpcLeaveInfo[]; // New field with detailed leave information
    absentDates: string[];
  };
}

// Add this to the utils.ts file where the conversion function is defined
export const convertTrpcAttendanceSummaryToAttendanceSummary = (
  summary: TrpcAttendanceSummary
): AttendanceSummary => {
  return {
    timeRange: {
      startDate: new Date(summary.timeRange.startDate),
      endDate: new Date(summary.timeRange.endDate),
    },
    unit: summary.unit,
    value: summary.value,
    stats: {
      daysWorked: summary.stats.daysWorked,
      daysOnLeave: summary.stats.daysOnLeave,
      daysAbsent: summary.stats.daysAbsent,
      totalWorkDays: summary.stats.totalWorkDays,
      // Convert string dates to Date objects
      workedDates: summary.stats.workedDates.map(date => new Date(date)),
      leaveDates: summary.stats.leaveDates.map(date => new Date(date)),
      leaveInfo: summary.stats.leaveInfo.map(info => ({
        date: new Date(info.date),
        reason: info.reason,
        approved: info.approved,
        approvedBy: info.approvedBy,
        approvedDate: info.approvedDate ? new Date(info.approvedDate) : undefined,
      })),
      absentDates: summary.stats.absentDates.map(date => new Date(date)),
    },
  };
};
