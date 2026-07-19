import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import type {
  UserState} from "../../store";
import {
  getAdmin,
  getUser,
  setAdmin,
  setAttendance,
  setAttendanceSummary
} from "../../store";
import { api } from "../../lib/api";
import { AttendanceOverview } from "./AttendanceOverview";
import { isToday } from "./utils";
import type {
  TrpcAttendance,
  TrpcUser,
  TrpcUserWithAttendance,
} from "../../store/utils";
import { UserRoleTypes } from "@prisma/client";
import type { DateHighlight} from "./Calendar";
import { HRCalendar, Legends } from "./Calendar";
import EmployeeList from "./EmployeeList";
import { CircularTimeTracking } from "./CircularTimeTracker";
import { generateTimeSegments } from "../../store/utils";
import type { TrpcAttendanceSummary } from "../../types/attendance";

export const AttendanceWrapper = (props: { date: Date }) => {
  const user = () => getUser();
  const isAdmin = () => user()?.roles.includes(UserRoleTypes.ADMIN);
  // Signal for currently-selected date
  const [selectedUser, setSelectedUser] = createSignal<UserState | null>(null);
  const [currentTime, setCurrentTime] = createSignal(new Date());

  // Signal for attendance summary
  const [summary, setSummary] = createSignal<TrpcAttendanceSummary | null>(
    null
  );

  // Consolidate all date highlights
  const [dateHighlights, setDateHighlights] = createSignal<
    Record<string, DateHighlight>
  >({});

  // Function to format date as YYYY-MM-DD for highlight keys
  const formatDateToYYYYMMDD = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(date.getDate()).padStart(2, "0")}`;
  };

  // Function to update highlights based on summary
  const updateHighlights = () => {
    const highlights: Record<string, DateHighlight> = {};
    const currentSummary = user()?.attendanceSummary;

    if (currentSummary) {
      // Add weekend highlights if they are worked days
      const workedDates: Date[] = currentSummary.stats.workedDates || [];
      workedDates.forEach((date) => {
        const day = date.getDay();
        if (day === 5 || day === 6) {
          const dateString = formatDateToYYYYMMDD(date);
          highlights[dateString] = {
            color: Legends.workedHolidaysOrWeekends,
            description: "Working on Weekend",
          };
        }
      });

      // Add absent dates
      currentSummary.stats.absentDates.forEach((date) => {
        const dateString = formatDateToYYYYMMDD(date);
        highlights[dateString] = {
          color: Legends.absences,
          description: "Absent",
          isAbsence: true,
        };
      });
    }

    setDateHighlights(highlights);
  };

  // Update highlights when user summary changes
  createEffect(() => {
    if (user()?.attendanceSummary) {
      updateHighlights();
    }
  });

  // Update time for circular tracker
  createEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 125);
    return () => clearInterval(timer);
  });

  // Signal to track if the attendance data is currently loading
  const [loadingAttendance, setLoadingAttendance] = createSignal(false);

  // Function to fetch attendance summary
  const fetchAttendanceSummary = async (date: Date, userId?: string) => {
    try {
      // Get the month start/end for the selected date
      const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      startOfMonth.setHours(0, 0, 0, 0);

      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      endOfMonth.setHours(23, 59, 59, 999);

      const summaryData = await api.attendance.getAttendanceSummary.query({
        startDate: startOfMonth.toISOString(),
        endDate: endOfMonth.toISOString(),
        unit: "month",
        userId: userId || undefined,
      });

      if (summaryData) {
        setSummary(summaryData);

        // Only update the store if we're looking at the current user
        if (!userId || userId === user()?.dbID) {
          setAttendanceSummary(summaryData);
        }
      }
    } catch (err) {
      console.error("Failed to fetch attendance summary:", err);
    }
  };

  // We'll fetch the attendance for the chosen date
  const fetchAttendance = async (theDate: Date) => {
    setLoadingAttendance(true);

    try {
      const promises: Promise<TrpcAttendance | TrpcUser[] | null>[] = [];
      promises.push(
        api.attendance.getAttendance.query({ date: theDate.toISOString() })
      );
      if (isAdmin()) {
        promises.push(
          api.admin.getForEveryoneAttendance.query({
            date: theDate.toISOString(),
          })
        );
      }
      const [currentUserAttendance, everyoneAttendance] = await Promise.all(
        promises
      );

      setAttendance(currentUserAttendance as TrpcAttendance | null);

      if (everyoneAttendance) {
        setAdmin(everyoneAttendance as TrpcUserWithAttendance[]);
      }

      // Fetch attendance summary for the selected user or current user
      await fetchAttendanceSummary(theDate, selectedUser()?.dbID);
    } catch (err) {
      console.error("Attendance fetch error:", err);
    } finally {
      setLoadingAttendance(false);
    }
  };

  onMount(() => {
    fetchAttendance(props.date);
  });

  onMount(() => {
    // Store subscription reference to ensure proper cleanup
    let subscription: ReturnType<
      typeof api.attendance.attendanceChanged.subscribe
    > | null = null;

    const setupSubscription = () => {
      // Cancel any existing subscription first
      if (subscription) {
        subscription.unsubscribe();
      }

      // Create new subscription
      subscription = api.attendance.attendanceChanged.subscribe(undefined, {
        onData: (updated) => {
          if (isToday(props.date) && updated.data.userId === getUser()?.dbID) {
            setAttendance(updated.data);
          }
        },
      });
    };

    // Initial setup
    setupSubscription();

    // Handle beforeunload event
    const handleUnload = () => {
      if (subscription) {
        subscription.unsubscribe();
        subscription = null;
      }
    };

    window.addEventListener("beforeunload", handleUnload);

    onCleanup(() => {
      if (subscription) {
        subscription.unsubscribe();
        subscription = null;
      }
      window.removeEventListener("beforeunload", handleUnload);
    });
  });

  const toTwoDigits = (num: number) => {
    return num < 10 ? `0${num}` : num.toString();
  };

  const handleDateChange = (date: Date) => {
    const dateString = `${date.getFullYear()}-${toTwoDigits(
      date.getMonth() + 1
    )}-${toTwoDigits(date.getDate())}`;

    window.history.pushState({}, "", `?date=${dateString}`);
    // Reload the page to reflect the new date
    window.location.reload();
  };

  // Get the current user data for the circular time tracker
  const overviewUser = () => {
    if (selectedUser()) {
      const selected = selectedUser();
      return (
        getAdmin()?.allUsers.find(
          (user) => user.dbID === selected?.dbID
        ) || getUser()
      );
    }
    return getUser();
  };

  // Update when selected user changes
  createEffect(() => {
    const user = selectedUser();
    if (user) {
      fetchAttendanceSummary(props.date, user.dbID);
    }
  });

  return (
    <div class="h-full">
      {/* Main responsive grid container */}
      <div
        class={`attendance-grid-container grid gap-6 ${
          isAdmin()
            ? "grid-cols-1 xl:grid-cols-2 2xl:grid-cols-2"
            : "grid-cols-1 2xl:grid-cols-3"
        }`}
      >
        {/* Calendar - now with context menu handlers */}
        <div class="min-h-[500px] rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900">
          <HRCalendar
            initialDate={props.date}
            weekendDays={[5, 6]}
            onSelect={handleDateChange}
            loading={loadingAttendance()}
            dateHighlights={dateHighlights()}
            monthStats={
              summary()
                ? {
                    absences: summary()?.stats.daysAbsent ?? 0,
                  }
                : undefined
            }
          />
        </div>

        {/* Employee List - only for admin, second in priority */}
        <Show when={isAdmin()}>
          <div class="max-h-[600px] overflow-auto rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900">
            <EmployeeList
              onUserSelect={setSelectedUser}
              loading={loadingAttendance()}
            />
          </div>
        </Show>

        {/* Overview - third in priority */}
        <div class="min-h-[500px] rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900">
          <Show when={user()?.attendance}>
            <AttendanceOverview
              loading={loadingAttendance()}
              selectedUser={selectedUser()}
            />
          </Show>
        </div>

        {/* Clock - fourth in priority */}
        <div class="flex min-h-[500px] items-center justify-center rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900">
          <Show
            when={!loadingAttendance() && overviewUser()?.attendance}
            fallback={
              <div class="flex h-full items-center justify-center">
                Loading...
              </div>
            }
          >
            {(attendance) => (
              <CircularTimeTracking
                timeSegments={generateTimeSegments(attendance())}
                currentTime={currentTime()}
              />
            )}
          </Show>
        </div>
      </div>
    </div>
  );
};
