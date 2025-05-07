export type TimeUnit = "week" | "month" | "quarter" | "year";

interface LeaveInfo {
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
