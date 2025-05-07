import {createEffect, createMemo, createSignal, Show} from 'solid-js';
import type {Component, JSX} from 'solid-js';
import {getEffectiveEndTime} from './CircularTimeTracker';
import {SpinningCircles} from '../SpinningCircles';
import {getAdmin, getAvatarUrl, getUser, UserState} from '~/store';
import {getScrumTime, wasInScrum} from './utils';
import {formatDuration} from '../util';
import {generateTimeSegments} from '~/store/utils';

interface AttendanceOverviewProps {
  loading: boolean;
  selectedUser?: UserState | null;
}

export const AttendanceOverview: Component<AttendanceOverviewProps> = props => {
  const overviewUser = () => {
    if (props.selectedUser) {
      return (
        getAdmin()?.allUsers.find(user => user.dbID === props.selectedUser?.dbID) ||
        (getUser() as UserState)
      );
    }
    return getUser() as UserState;
  };

  const [currentTime, setCurrentTime] = createSignal(new Date());
  createEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 125);
    return () => clearInterval(timer);
  });

  const currentStatus = createMemo(() => {
    const segments = generateTimeSegments(overviewUser().attendance);
    const lastSegment = segments[segments.length - 1];

    if (!overviewUser().attendance.loggedInTime) {
      return {status: 'Not Logged In', duration: null};
    }

    if (overviewUser().attendance.loggedOutTime) {
      return {
        status: 'Logged Out',
        duration: null,
        time: overviewUser().attendance.loggedOutTime,
      };
    }

    if (!lastSegment || currentTime() < lastSegment.start) {
      return {status: 'Not Logged In', duration: null};
    }

    if (
      currentTime() >= lastSegment.start &&
      currentTime() <= getEffectiveEndTime(lastSegment, currentTime())
    ) {
      const duration = Math.floor(currentTime().getTime() - lastSegment.start.getTime());
      return {
        status: lastSegment.type === 'work' ? `Working in ${lastSegment.channel}` : 'On Break',
        duration,
      };
    }

    return {status: 'Status Unknown', duration: null};
  });

  const hoursWorked = createMemo(() => {
    return formatDuration(
      generateTimeSegments(overviewUser().attendance).reduce((total, segment) => {
        if (segment.type === 'work') {
          return (
            total +
            (getEffectiveEndTime(segment, currentTime()).getTime() - segment.start.getTime())
          );
        }
        return total;
      }, 0)
    );
  });

  const mostWorkedProject = createMemo(() => {
    const projectDurations = generateTimeSegments(overviewUser().attendance).reduce(
      (acc, segment) => {
        if (segment.type === 'work' && segment.channel) {
          const duration =
            getEffectiveEndTime(segment, currentTime()).getTime() - segment.start.getTime();
          acc[segment.channel] = (acc[segment.channel] || 0) + duration;
        }
        return acc;
      },
      {} as Record<string, number>
    );
    return Object.entries(projectDurations).sort((a, b) => b[1] - a[1])[0];
  });

  const formatTime = (date?: Date) => {
    return date?.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  const getStatsRow = (label: string, value: string | number | JSX.Element) => {
    return (
      <div class="flex items-center justify-between rounded bg-gray-100 p-3 dark:bg-neutral-800">
        <span class="font-medium">{label}</span>
        <Show when={!props.loading} fallback={<SpinningCircles height={25} />}>
          {value}
        </Show>
      </div>
    );
  };

  return (
    <div class="mx-auto h-full">
      <div class="mb-4 flex items-center space-x-4">
        <img
          src={getAvatarUrl(overviewUser().discordID, overviewUser().discordAvatarId)!}
          alt={`${overviewUser().name} avatar`}
          class="h-16 w-16 rounded-full object-cover"
        />
        <h2 class="text-2xl font-bold">{overviewUser().name}'s Overview</h2>
      </div>
      <div class="flex flex-col space-y-4">
        {getStatsRow(
          'Current Status',
          <span
            class={`rounded-full px-3 py-1 ${
              currentStatus().status.includes('Working')
                ? 'bg-green-100 text-green-800'
                : currentStatus().status.includes('Break')
                  ? 'bg-yellow-100 text-yellow-800'
                  : 'bg-gray-100 text-gray-800'
            }`}
          >
            {currentStatus().status}
            {currentStatus().duration && ` (${formatDuration(currentStatus().duration!)})`}
          </span>
        )}
        {getStatsRow('Login Time', formatTime(overviewUser().attendance.loggedInTime))}
        <Show when={overviewUser().attendance.loggedOutTime}>
          {getStatsRow('Logout Time', formatTime(overviewUser().attendance.loggedOutTime))}
        </Show>
        {getStatsRow('Hours Worked Today', `${hoursWorked()}`)}
        {getStatsRow(
          'Scrum Attendance',
          <span
            class={`rounded-full px-3 py-1 ${
              wasInScrum(overviewUser().attendance)
                ? 'bg-green-100 text-green-800'
                : 'bg-red-100 text-red-800'
            }`}
          >
            {wasInScrum(overviewUser().attendance)
              ? `Present (${formatTime(getScrumTime(new Date(overviewUser().attendance.loggedInTime || new Date())))})`
              : 'Absent'}
          </span>
        )}
        <Show when={mostWorkedProject()}>
          {getStatsRow(
            'Most Active Project',
            `${mostWorkedProject()[0]} (${formatDuration(mostWorkedProject()[1])})`
          )}
        </Show>
      </div>
    </div>
  );
};
