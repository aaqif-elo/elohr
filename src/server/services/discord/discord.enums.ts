export enum EAttendanceCommands {
  START_WORK = "start_work",
  END_WORK = "end_work",
  SWITCH_WORK = "switch_work",
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

export enum EReportCommands {
  REPORT = "report",
}

export enum EProjectCommands {
  PROJECT = "project",
}

export enum EProjectSubcommands {
  LIST = "list",
  CREATE = "create",
  DELETE = "delete",
  ASSIGN = "assign",
  UNASSIGN = "unassign",
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
