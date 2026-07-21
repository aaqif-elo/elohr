import type {Attendance} from '../../store';

function getTimezoneDifference() {
  const now = new Date();
  const localOffset = -now.getTimezoneOffset();
  const targetOffset =
    new Date(
      now.toLocaleString('en-US', {timeZone: import.meta.env.VITE_TEAM_TZ || 'UTC'})
    ).getTime() - new Date(now.toLocaleString('en-US', {timeZone: 'UTC'})).getTime();
  const targetOffsetMinutes = targetOffset / (1000 * 60);
  return (targetOffsetMinutes - localOffset) / 60;
}

export const getScrumTime = (givenTime: Date) => {
  const scrumTime = new Date(givenTime);
  scrumTime.setHours(10);
  scrumTime.setMinutes(45);
  const hourDifference = getTimezoneDifference();
  scrumTime.setHours(scrumTime.getHours() - hourDifference);
  return scrumTime;
};

function isTimeWithinRange(dateToCheck: Date, start: Date, end: Date): boolean {
  const getMinutesSinceMidnight = (date: Date): number =>
    date.getHours() * 60 + date.getMinutes();

  const time = getMinutesSinceMidnight(dateToCheck);
  const startTime = getMinutesSinceMidnight(start);
  const endTime = getMinutesSinceMidnight(end);

  if (startTime <= endTime) {
    return time >= startTime && time <= endTime;
  } else {
    return time >= startTime || time <= endTime;
  }
}

export const wasInScrum = (attendance?: Attendance) => {
  if (!attendance?.workSegments?.length) return false;
  const scrumTime = getScrumTime(new Date(attendance.workSegments[0].start));
  return attendance.workSegments.some(segment => {
    if (!segment.end) return false;
    return isTimeWithinRange(scrumTime, segment.start, segment.end);
  });
};

export function isToday(selected: Date) {
  const now = new Date();
  return (
    now.getFullYear() === selected.getFullYear() &&
    now.getMonth() === selected.getMonth() &&
    now.getDate() === selected.getDate()
  );
}

export const getSystemTheme = () => {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

export const getStatus = (attendance?: Attendance): 'present' | 'absent' => {
  return attendance?.workSegments?.length ? 'present' : 'absent';
};
