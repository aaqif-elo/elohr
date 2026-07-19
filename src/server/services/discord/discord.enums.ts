export enum EAttendanceCommands {
  LOGIN = "available",
  LOGOUT = "logout",
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
