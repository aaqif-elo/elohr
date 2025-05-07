export enum EAttendanceCommands {
  BREAK = 'break',
  RESUME = 'back',
  LOGIN = 'available',
  LOGOUT = 'oftd',
  SWITCH = 'switch',
}

export enum EAdminCommands {
  GET_HOLIDAY_ANNOUNCEMENT = 'get-holiday-announcement',
  OVERRIDE_HOLIDAY_ANNOUNCEMENT = 'override-holiday-announcement',
  ANNOUNCE_NEXT_HOLIDAY = 'announce-next-holiday',
}

export enum ELeaveCommands {
  REQUEST_LEAVE = 'request-leave',
  REVIEW_LEAVE_REQUEST = 'review-leave-request',
}
export enum ESlashCommandOptionNames {
  BREAK_REASON = 'reason',
  REPORT_DAYS = 'days',
  REPORT_USER = 'user',
}

export enum EAuthCommands {
  HR = 'hr',
}
