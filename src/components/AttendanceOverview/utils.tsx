import {Attendance} from '../../store';
import {generateTimeSegments} from '../../store/utils';

function getTimezoneDifference() {
  // Get current date in local timezone and target timezone
  const now = new Date();

  // Get current timezone offset in minutes
  const localOffset = -now.getTimezoneOffset();

  // Get target timezone offset using Intl.DateTimeFormat
  const targetOffset =
    new Date(
      now.toLocaleString('en-US', {timeZone: import.meta.env.VITE_TEAM_TZ || 'UTC'})
    ).getTime() - new Date(now.toLocaleString('en-US', {timeZone: 'UTC'})).getTime();

  // Convert target offset from milliseconds to minutes
  const targetOffsetMinutes = targetOffset / (1000 * 60);

  // Calculate difference in hours
  const hourDifference = (targetOffsetMinutes - localOffset) / 60;

  return hourDifference;
}

export const getScrumTime = (givenTime: Date) => {
  const scrumTime = new Date(givenTime);
  const scrumHours = 10;
  const scrumMins = 45;

  scrumTime.setHours(scrumHours);
  scrumTime.setMinutes(scrumMins);

  const hourDifference = getTimezoneDifference();

  scrumTime.setHours(scrumTime.getHours() - hourDifference);

  return scrumTime;
};

function isTimeWithinRange(dateToCheck: Date, start: Date, end: Date): boolean {
  // Helper function to convert a Date's time (hours and minutes) to minutes since midnight.
  const getMinutesSinceMidnight = (date: Date): number => {
    return date.getHours() * 60 + date.getMinutes();
  };

  const time = getMinutesSinceMidnight(dateToCheck);
  const startTime = getMinutesSinceMidnight(start);
  const endTime = getMinutesSinceMidnight(end);

  if (startTime <= endTime) {
    // The range does not cross midnight.
    return time >= startTime && time <= endTime;
  } else {
    // The range crosses midnight (e.g., 22:00 to 02:00).
    // In this case, the valid times are either on or after startTime
    // or on or before endTime.
    return time >= startTime || time <= endTime;
  }
}

// (B) wasInScrum
export const wasInScrum = (attendance?: Attendance) => {
  if (!attendance?.loggedInTime) return false;

  const scrumTime = getScrumTime(new Date(attendance.loggedInTime));

  let workSegmentToUse: {
    start: Date;
    end?: Date | null;
    length_ms: number | null;
  }[] = attendance.workSegments;
  if (!attendance.workSegments || attendance.workSegments.length === 0) {
    workSegmentToUse = generateTimeSegments(attendance);
  }

  return workSegmentToUse.some(segment => {
    if (!segment.end) return false;

    return isTimeWithinRange(scrumTime, segment.start, segment.end);
  });
};

/**
 * Return whether the selected date is "today" in local time.
 * If so, we might poll for real-time updates.
 */
export function isToday(selected: Date) {
  const now = new Date();
  return (
    now.getFullYear() === selected.getFullYear() &&
    now.getMonth() === selected.getMonth() &&
    now.getDate() === selected.getDate()
  );
}

// A utility that returns 'dark' or 'light' based on user system settings
export const getSystemTheme = () => {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getStatus = (attendance?: Attendance): 'present' | 'on break' | 'absent' => {
  if (attendance && attendance.loggedInTime) {
    if (!attendance.loggedOutTime) {
      // Check for an ongoing break
      if (attendance.breaks && attendance.breaks.find(b => !b.end)) {
        return 'on break';
      }
    }
    return 'present';
  }
  return 'absent';
};
