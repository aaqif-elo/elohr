export enum EAttendanceCommands {
  BREAK = "break",
  RESUME = "back",
  LOGIN = "available",
  SWITCH = "switch",
}

export enum EAdminCommands {
  GET_HOLIDAY_ANNOUNCEMENT = "next-holiday",
}

export enum ELeaveCommands {
  REQUEST_LEAVE = "request-leave",
}

export enum EAuthCommands {
  HR = "hr",
}

export enum EAvailabilityCommands {
  AVAILABILITY = "availability",
}

export enum ERecordingCommands {
  RECORD = "record",
}

export enum ERecordingStage {
  STARTED = "started",
  STOPPED = "stopped",
  QUEUED = "queued",
  PROCESSING = "processing",
  TRANSCRIBING = "transcribing",
  SUMMARIZING = "summarizing",
  COMPLETE = "complete",
  ERROR = "error",
}
