import {FetchEvent} from '@solidjs/start/server';

export const requestLogger = async (event: FetchEvent) => {
  if (!event.request.url.includes('attendance.getLatestAttendance')) {
    console.log(event.request.url, event.request.method, event.request.headers);
  }
};
