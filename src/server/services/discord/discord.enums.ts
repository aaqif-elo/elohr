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

export enum EMeetingCommands {
  MEETING = "meeting",
}

export enum EAvailabilityCommands {
  AVAILABILITY = "availability",
}

// Participant option names for the /meeting command
enum EMeetingParticipantOptions {
  PARTICIPANT1 = "participant1",
  PARTICIPANT2 = "participant2",
  PARTICIPANT3 = "participant3",
  PARTICIPANT4 = "participant4",
  PARTICIPANT5 = "participant5",
}

// Convenience list for iteration in builders/handlers
export const MEETING_PARTICIPANT_OPTION_NAMES: readonly string[] =
  Object.values(EMeetingParticipantOptions);
