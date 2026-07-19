export type TimeUnit = "week" | "month" | "quarter" | "year";

export interface AttendanceSummary {
  timeRange: {
    startDate: Date;
    endDate: Date;
  };
  unit: TimeUnit;
  value: string | number;
  stats: {
    daysWorked: number;
    daysAbsent: number;
    totalWorkDays: number;
    workedDates: Date[];
    absentDates: Date[];
  };
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
    daysAbsent: number;
    totalWorkDays: number;
    workedDates: string[];
    absentDates: string[];
  };
}
