import {createSignal, For, Show} from 'solid-js';
import type {Component} from 'solid-js';
import {getSystemTheme} from './utils';
import {TimeSegment} from '../../store/utils';

// New interface for segment summaries
interface SegmentSummary {
  totalDuration: number;
  segmentCount: number;
  averageDuration: number;
}

// Replace the current color palettes with these more diverse ones
const LIGHT_COLORS = [
  'rgb(191, 219, 254)', // blue-200
  'rgb(253, 186, 116)', // orange-200
  'rgb(167, 243, 208)', // emerald-200
  'rgb(254, 202, 202)', // red-200
  'rgb(216, 180, 254)', // purple-200
  'rgb(252, 211, 77)',  // yellow-300
];

// More distinct dark theme colors
const DARK_COLORS = [
  'rgb(59, 130, 246)',  // blue-500
  'rgb(249, 115, 22)',  // orange-500
  'rgb(16, 185, 129)',  // emerald-500
  'rgb(239, 68, 68)',   // red-500
  'rgb(168, 85, 247)',  // purple-500
  'rgb(245, 158, 11)',  // amber-500
];

/**
 * Hash a string (the channel name) into an integer
 * for consistent color assignment from an array.
 */
const hashChannel = (channel: string) => {
  return channel.split('').reduce((acc, char) => {
    return char.charCodeAt(0) + ((acc << 5) - acc);
  }, 0);
};

/**
 * Returns a color from either the LIGHT_COLORS or DARK_COLORS palette,
 * based on the current theme.
 */
const getChannelColor = (channel: string): string => {
  const theme = getSystemTheme();
  const palette = theme === 'dark' ? DARK_COLORS : LIGHT_COLORS;
  const hash = hashChannel(channel);
  return palette[Math.abs(hash) % palette.length];
};

// Helper function to get the effective end time of a segment
export const getEffectiveEndTime = (segment: TimeSegment, currentTime: Date): Date => {
  return segment.end || currentTime;
};

// CircularTimeTracking Component (24-hour version)
export const CircularTimeTracking: Component<{
  timeSegments: TimeSegment[];
  currentTime: Date;
}> = props => {
  const [activeSegment, setActiveSegment] = createSignal<number | null>(null);
  const [activeLegendItem, setActiveLegendItem] = createSignal<string | null>(null);

  // Angle calculation for a 24-hour clock
  // Each hour = 15° => hour * 15°, minutes => minute * 0.25°, etc.
  const calculateSegment = (
    startHour: number,
    startMinute: number,
    endHour: number,
    endMinute: number
  ) => {
    // Convert hours/minutes to angles (24-hour)
    const startAngle = startHour * 15 + startMinute * 0.25 - 90;
    const endAngle = endHour * 15 + endMinute * 0.25 - 90;

    // Normalize angle difference into [0, 360)
    let diff = endAngle - startAngle;
    diff = (diff + 360) % 360;
    const largeArc = diff > 180 ? 1 : 0;

    const start = {
      x: 150 + 145 * Math.cos((startAngle * Math.PI) / 180),
      y: 150 + 145 * Math.sin((startAngle * Math.PI) / 180),
    };
    const end = {
      x: 150 + 145 * Math.cos((endAngle * Math.PI) / 180),
      y: 150 + 145 * Math.sin((endAngle * Math.PI) / 180),
    };

    return {
      d: `M 150 150 
        L ${start.x} ${start.y} 
        A 145 145 0 ${largeArc} 1 ${end.x} ${end.y} 
        Z`,
    };
  };

  const getSegmentColor = (segment: TimeSegment) => {
    if (segment.type === 'break') {
      // Subdued gray for breaks
      return 'rgb(156, 163, 175)'; // gray-400
    }

    const theme = getSystemTheme();

    if (segment.channel) {
      return getChannelColor(segment.channel);
    }

    // Fallback color if no channel is set
    return theme === 'dark'
      ? 'rgb(59, 130, 246)' // default for dark
      : 'rgb(147, 197, 253)'; // default for light
  };

  // Format time in 24-hour format
  const formatTime = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  const getDuration = (segment: TimeSegment) => {
    const effectiveEnd = getEffectiveEndTime(segment, props.currentTime);
    const durationInMinutes = Math.round(
      (effectiveEnd.getTime() - segment.start.getTime()) / (1000 * 60)
    );

    if (durationInMinutes < 60) {
      return `${durationInMinutes}m`;
    }
    const hours = Math.floor(durationInMinutes / 60);
    const minutes = durationInMinutes % 60;
    return minutes > 0 ? `${hours}h${minutes}m` : `${hours}h`;
  };

  // Get unique channels for legend
  const getUniqueChannels = () => {
    const channels = new Set<string>();
    props.timeSegments.forEach(segment => {
      if (segment.type === 'work' && segment.channel) {
        channels.add(segment.channel);
      }
    });
    return Array.from(channels);
  };

  // Calculate segment summaries
  const calculateSegmentSummary = (segments: TimeSegment[]): SegmentSummary => {
    const totalDuration = segments.reduce((acc, segment) => {
      const effectiveEnd = getEffectiveEndTime(segment, props.currentTime);
      return acc + (effectiveEnd.getTime() - segment.start.getTime());
    }, 0);

    return {
      totalDuration: totalDuration,
      segmentCount: segments.length,
      averageDuration: totalDuration / segments.length,
    };
  };

  // Format duration in milliseconds to human readable string
  const formatDuration = (duration: number) => {
    const minutes = Math.round(duration / (1000 * 60));
    if (minutes < 60) {
      return `${minutes}m`;
    }
    const hours = Math.floor(minutes / 60);
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0 ? `${hours}h${remainingMinutes}m` : `${hours}h`;
  };

  // Get segments for a specific channel or type
  const getSegmentsForLegendItem = (item: string) => {
    if (item === 'break') {
      return props.timeSegments.filter(segment => segment.type === 'break');
    }
    return props.timeSegments.filter(
      segment => segment.type === 'work' && segment.channel === item
    );
  };

  return (
    <div class="relative">
      <div class="h-[500px] w-[500px]">
        <svg viewBox="0 0 300 300" class="h-full w-full">
          {/* Clock face circle */}
          <circle
            cx="150"
            cy="150"
            r="145"
            class="fill-gray-50 stroke-gray-200 stroke-2 dark:fill-neutral-800"
          />

          {/* Hour markers (24) */}
          <For each={Array(24).fill(0)}>
            {(_, i) => {
              // Each hour is 15° => i() * 15°, minus 90° for top alignment
              const angle = (i() * 15 - 90) * (Math.PI / 180);
              const x1 = 150 + 135 * Math.cos(angle);
              const y1 = 150 + 135 * Math.sin(angle);
              const x2 = 150 + 145 * Math.cos(angle);
              const y2 = 150 + 145 * Math.sin(angle);

              return (
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  class="stroke-gray-400 stroke-1 dark:stroke-gray-100"
                  pointer-events="none"
                />
              );
            }}
          </For>

          {/* 
            ADDING AN INTERNAL DIAL FOR MINUTES 
            ------------------------------------
            We can make a smaller inner circle for minute markers.
            Each minute is 6°, so i() * 6 - 90 for the angle.
          */}
          <For each={Array(60).fill(0)}>
            {(_, i) => {
              const angle = (i() * 6 - 90) * (Math.PI / 180);
              // We draw minute ticks from r=110 to r=115 (for example)
              // so they appear inside the hour ring.
              const x1 = 150 + 70 * Math.cos(angle);
              const y1 = 150 + 70 * Math.sin(angle);
              const x2 = 150 + 75 * Math.cos(angle);
              const y2 = 150 + 75 * Math.sin(angle);

              return (
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  // A slightly lighter stroke so it doesn't overpower hour markers
                  class="stroke-gray-300 stroke-1 dark:stroke-gray-500"
                  pointer-events="none"
                />
              );
            }}
          </For>

          {/* Optionally label multiples of 5 minutes around the inner dial */}
          <For each={[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]}>
            {minute => {
              const angle = (minute * 6 - 90) * (Math.PI / 180);
              // Position the text a bit closer to the center or slightly offset
              const x = 150 + 55 * Math.cos(angle);
              const y = 150 + 55 * Math.sin(angle);

              return (
                <text
                  x={x}
                  y={y}
                  text-anchor="middle"
                  dominant-baseline="middle"
                  class="fill-gray-500 text-xs font-light dark:fill-gray-400"
                  pointer-events="none"
                  style="user-select: none; cursor: default;"
                >
                  {minute}
                </text>
              );
            }}
          </For>
          {/* Time segments */}
          <For each={props.timeSegments}>
            {segment => {
              const effectiveEnd = () => getEffectiveEndTime(segment, props.currentTime);
              const segmentPath = () => {
                return calculateSegment(
                  segment.start.getHours(),
                  segment.start.getMinutes(),
                  effectiveEnd().getHours(),
                  effectiveEnd().getMinutes()
                );
              };

              return (
                <path
                  d={segmentPath().d}
                  style={
                    segment.type === 'break'
                      ? {
                          opacity: 0.35,
                        }
                      : {fill: getSegmentColor(segment)}
                  }
                  class={`cursor-pointer transition-all duration-200 ${
                    activeSegment() === segment.id ? 'opacity-80' : 'opacity-100'
                  } hover:opacity-100 ${!segment.end ? 'animate-pulse' : ''}`}
                  onMouseEnter={() => setActiveSegment(segment.id)}
                  onMouseLeave={() => setActiveSegment(null)}
                />
              );
            }}
          </For>

          {/* Clock hands */}
          {(() => {
            const time = props.currentTime;
            const hours = time.getHours();
            const minutes = time.getMinutes();
            const seconds = time.getSeconds();
            const milliseconds = time.getMilliseconds();

            // For a 24-hour clock, hour hand rotates 360° in 24 hours => 15°/hour
            // hourFraction includes partial hour from minutes/seconds/ms
            const hourFraction = hours + minutes / 60 + seconds / 3600 + milliseconds / 3600000;
            const hourAngle = (hourFraction * 15 - 90) * (Math.PI / 180);

            // Minute hand standard: 360° in 60 minutes => 6°/minute
            // includes partial minute from seconds/ms
            const minuteFraction = minutes + seconds / 60 + milliseconds / 60000;
            const minuteAngle = (minuteFraction * 6 - 90) * (Math.PI / 180);

            // Second hand standard: 360° in 60 seconds => 6°/second
            // includes partial second from ms
            const secondFraction = seconds + milliseconds / 1000;
            const secondAngle = (secondFraction * 6 - 90) * (Math.PI / 180);

            const hourX = 150 + 80 * Math.cos(hourAngle);
            const hourY = 150 + 80 * Math.sin(hourAngle);
            const minuteX = 150 + 110 * Math.cos(minuteAngle);
            const minuteY = 150 + 110 * Math.sin(minuteAngle);
            const secondX = 150 + 130 * Math.cos(secondAngle);
            const secondY = 150 + 130 * Math.sin(secondAngle);

            return (
              <>
                <line
                  x1="150"
                  y1="150"
                  x2={hourX}
                  y2={hourY}
                  class="stroke-gray-800 stroke-3 dark:stroke-gray-200"
                />
                <line
                  x1="150"
                  y1="150"
                  x2={minuteX}
                  y2={minuteY}
                  class="stroke-gray-600 stroke-2 dark:stroke-gray-400"
                />
                <line
                  x1="150"
                  y1="150"
                  x2={secondX}
                  y2={secondY}
                  class="stroke-red-500 stroke-1"
                  style="transition: all 125ms linear"
                />
                <circle cx="150" cy="150" r="4" class="fill-gray-800 dark:fill-gray-200" />
              </>
            );
          })()}

          {/* Hour numbers (0-23) */}
          <For each={Array(24).fill(0)}>
            {(_, i) => {
              const angle = (i() * 15 - 90) * (Math.PI / 180);
              const x = 150 + 120 * Math.cos(angle);
              const y = 150 + 120 * Math.sin(angle);

              return (
                <text
                  x={x}
                  y={y}
                  text-anchor="middle"
                  dominant-baseline="middle"
                  class="fill-gray-600 text-sm font-light dark:fill-gray-200"
                  pointer-events="none"
                  style="user-select: none; cursor: default;"
                >
                  {i()}
                </text>
              );
            }}
          </For>
          <text
            x="150"
            y="125"
            text-anchor="middle"
            dominant-baseline="middle"
            class="fill-gray-800 text-xs font-semibold opacity-65 dark:fill-gray-200"
          >
            {props.currentTime.toLocaleTimeString('en-US', {
              hour: 'numeric',
              minute: '2-digit',
              hour12: true,
            })}
          </text>
        </svg>

        {/* Hover details */}
        <Show when={activeSegment()}>
          <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 transform rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-800">
            {(() => {
              const segment = props.timeSegments.find(s => s.id === activeSegment());
              if (!segment) return null;

              const effectiveEnd = getEffectiveEndTime(segment, props.currentTime);

              return (
                <div class="text-sm">
                  <p class="font-bold">{segment.type === 'work' ? 'Work Period' : 'Break'}</p>
                  <p>
                    {formatTime(segment.start)} -{' '}
                    {!segment.end ? 'Ongoing' : formatTime(effectiveEnd)}
                  </p>
                  {segment.channel && <p>Channel: {segment.channel}</p>}
                  <p>Duration: {getDuration(segment)}</p>
                </div>
              );
            })()}
          </div>
        </Show>
      </div>

      {/* Enhanced Legend with Hover Summaries */}
      <div class="mt-4 flex max-w-[500px] flex-wrap gap-4">
        {/* Break type legend item */}
        <div
          class="relative mb-2 flex cursor-pointer items-center gap-2"
          onMouseEnter={() => setActiveLegendItem('break')}
          onMouseLeave={() => setActiveLegendItem(null)}
        >
          <div class="h-4 w-4 rounded-full" style={{'background-color': 'rgb(156, 163, 175)'}} />
          <span class="text-sm">Break</span>

          <Show when={activeLegendItem() === 'break'}>
            <div class="absolute bottom-full left-0 mb-2 w-64 rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-800">
              {(() => {
                const segments = getSegmentsForLegendItem('break');
                const summary = calculateSegmentSummary(segments);
                return (
                  <div class="text-sm">
                    <p class="font-bold">Break Periods Summary</p>
                    <p>Total Breaks: {summary.segmentCount}</p>
                    <p>Total Duration: {formatDuration(summary.totalDuration)}</p>
                    <p>Average Duration: {formatDuration(summary.averageDuration)}</p>
                  </div>
                );
              })()}
            </div>
          </Show>
        </div>

        {/* Work channels legend items */}
        <For each={getUniqueChannels()}>
          {channel => (
            <div
              class="relative mb-2 flex cursor-pointer items-center gap-2"
              onMouseEnter={() => setActiveLegendItem(channel)}
              onMouseLeave={() => setActiveLegendItem(null)}
            >
              <div
                class="h-4 w-4 rounded-full"
                style={{'background-color': getChannelColor(channel)}}
              />
              <span class="text-sm">{channel}</span>

              <Show when={activeLegendItem() === channel}>
                <div class="absolute bottom-full left-0 mb-2 w-64 rounded-lg bg-white p-4 shadow-lg dark:bg-neutral-800">
                  {(() => {
                    const segments = getSegmentsForLegendItem(channel);
                    const summary = calculateSegmentSummary(segments);
                    return (
                      <div class="text-sm">
                        <p class="font-bold">{channel} Channel Summary</p>
                        <p>Total Segments: {summary.segmentCount}</p>
                        <p>Total Duration: {formatDuration(summary.totalDuration)}</p>
                        <p>Average Duration: {formatDuration(summary.averageDuration)}</p>
                      </div>
                    );
                  })()}
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  );
};
