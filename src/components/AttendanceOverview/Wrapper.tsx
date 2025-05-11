import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import {
  getAdmin,
  getUser,
  setAdmin,
  setAttendance,
  setAttendanceSummary,
  UserState,
} from "../../store";
import { api } from "../../lib/api";
import { AttendanceOverview } from "./AttendanceOverview";
import { isToday } from "./utils";
import {
  TrpcAttendance,
  TrpcUser,
  TrpcUserWithAttendance,
} from "../../store/utils";
import { UserRoleTypes } from "@prisma/client";
import { HRCalendar, DateHighlight } from "./Calendar";
import EmployeeList from "./EmployeeList";
import { CircularTimeTracking } from "./CircularTimeTracker";
import { generateTimeSegments } from "../../store/utils";
import { TrpcAttendanceSummary } from "../../types/attendance";
import { HolidayModal } from "./HolidayModal";
import toast from "solid-toast";

// Update LeaveRequestModal to accept array of dates
const LeaveRequestModal = (props: {
  isOpen: boolean;
  dates: Date[];
  onClose: () => void;
  onConfirm: (dates: Date[], reason: string) => void;
}) => {
  const [reason, setReason] = createSignal("");
  const isReasonRequired = () => props.dates.length > 2;

  const handleSubmit = (e: Event) => {
    e.preventDefault();
    if (isReasonRequired() && !reason()) {
      toast.error("Reason is required for leave requests longer than 2 days");
      return;
    }
    props.onConfirm(props.dates, reason());
    setReason(""); // Reset the form
  };

  if (!props.isOpen) return null;

  return (
    <div class="bg-opacity-50 fixed inset-0 z-50 flex items-center justify-center bg-black">
      <div class="w-full max-w-md rounded-lg bg-white p-6 shadow-xl dark:bg-neutral-800">
        <h2 class="mb-4 text-xl font-bold">Request Leave</h2>
        <div class="mb-4">
          <p class="font-medium">Selected Dates ({props.dates.length} days):</p>
          <div class="mt-2 max-h-40 overflow-auto rounded border p-2">
            {props.dates.map((date) => (
              <div class="py-1">
                <span class="font-medium text-blue-600 dark:text-blue-400">
                  {date.toLocaleDateString("en-US", { weekday: "long" })}
                </span>{" "}
                -{" "}
                {date.toLocaleDateString("en-US", {
                  year: "numeric",
                  month: "short",
                  day: "numeric",
                })}
              </div>
            ))}
          </div>
        </div>
        <form onSubmit={handleSubmit}>
          <div class="mb-4">
            <label class="mb-2 block text-sm font-medium" for="reason">
              Reason {isReasonRequired() ? "(required)" : "(optional)"}
            </label>
            <textarea
              id="reason"
              value={reason()}
              onInput={(e) => setReason(e.currentTarget.value)}
              class="w-full rounded-lg border p-2.5 text-sm"
              placeholder="Enter reason for leave request"
            />
          </div>
          <div class="flex justify-end space-x-2">
            <button
              type="button"
              onClick={props.onClose}
              class="rounded-lg border px-5 py-2.5 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              disabled={isReasonRequired() && !reason()}
              type="submit"
              class="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400 disabled:opacity-50"
            >
              Submit Request
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export const AttendanceWrapper = () => {
  const user = () => getUser();
  const isAdmin = () => user()?.roles.includes(UserRoleTypes.ADMIN);

  // Signal for currently-selected date
  const [selectedDate, setSelectedDate] = createSignal(new Date());
  const [selectedUser, setSelectedUser] = createSignal<UserState | null>(null);
  const [currentTime, setCurrentTime] = createSignal(new Date());

  // Signal for attendance summary
  const [summary, setSummary] = createSignal<TrpcAttendanceSummary | null>(
    null
  );

  // Add a signal to store holiday highlights
  const [holidayHighlights, setHolidayHighlights] = createSignal<
    Record<string, DateHighlight>
  >({});

  // Consolidate all date highlights
  const [dateHighlights, setDateHighlights] = createSignal<
    Record<string, DateHighlight>
  >({});

  // Add these signals inside the AttendanceWrapper component
  const [holidayModalOpen, setHolidayModalOpen] = createSignal(false);
  const [selectedHolidayDate, setSelectedHolidayDate] =
    createSignal<Date | null>(null);

  // Simplified state for leave request
  const [leaveModalOpen, setLeaveModalOpen] = createSignal(false);
  const [selectedLeaveDates, setSelectedLeaveDates] = createSignal<Date[]>([]);

  // Function to format date as YYYY-MM-DD for highlight keys
  const formatDateToYYYYMMDD = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(date.getDate()).padStart(2, "0")}`;
  };

  // Function to update highlights based on summary and holidays
  const updateHighlights = () => {
    const highlights: Record<string, DateHighlight> = {
      ...holidayHighlights(),
    };
    const currentSummary = user()?.attendanceSummary;

    if (currentSummary) {
      // Process detailed leave information first
      if (currentSummary.stats.leaveInfo) {
        currentSummary.stats.leaveInfo.forEach((leaveInfo) => {
          const dateString = formatDateToYYYYMMDD(leaveInfo.date);

          // Create descriptive text
          let description = "On Leave";
          let descriptionDetails = "";

          // Add reason if available
          if (leaveInfo.reason) {
            description = `On Leave (${leaveInfo.reason})`;
          }

          // Add approval details if available
          if (leaveInfo.approved && leaveInfo.approvedDate) {
            const approvalDate = leaveInfo.approvedDate.toLocaleDateString(
              "en-US",
              {
                year: "numeric",
                month: "short",
                day: "numeric",
              }
            );
            descriptionDetails = `Approved on ${approvalDate}`;
          }

          highlights[dateString] = {
            color: "#FFA726", // Orange for leaves
            description,
            descriptionDetails: descriptionDetails || undefined,
            isLeave: true,
          };
        });
      } else {
        // Fallback to original implementation if leaveInfo is not available
        currentSummary.stats.leaveDates.forEach((date) => {
          const dateString = formatDateToYYYYMMDD(date);
          highlights[dateString] = {
            color: "#FFA726", // Orange for leaves
            description: "On Leave",
            isLeave: true,
          };
        });
      }

      // Add absent dates
      currentSummary.stats.absentDates.forEach((date) => {
        const dateString = formatDateToYYYYMMDD(date);
        highlights[dateString] = {
          color: "#F44336", // Red for absences
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

  // Merge holiday highlights when they are fetched
  createEffect(() => {
    if (Object.keys(holidayHighlights()).length > 0) {
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

  // Function to fetch holidays for a specific year
  const fetchHolidays = async (year?: string) => {
    try {
      const holidays = await api.holidays.getHolidaysForYear.query({
        year: year || selectedDate().getFullYear().toString(),
      });

      // Format holidays for the calendar
      const highlights: Record<string, DateHighlight> = {};

      holidays.forEach((holiday) => {
        // Get the effective date (either overriden or original)
        const effectiveDate = holiday.overridenDate || holiday.originalDate;

        // Convert to Date object if it's a string
        const dateObj = new Date(effectiveDate);

        // Format date as YYYY-MM-DD
        const dateString = formatDateToYYYYMMDD(dateObj);

        // Create base description details
        let details = holiday.description || "";

        // Add original date info if the holiday was shifted
        if (holiday.overridenDate) {
          const originalDate = new Date(holiday.originalDate);
          const formattedOriginalDate = originalDate.toLocaleDateString(
            "en-US",
            {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            }
          );

          // Add original date information to description details
          details = details
            ? `${details}\n\nOriginal date: ${formattedOriginalDate}`
            : `Original date: ${formattedOriginalDate}`;
        }

        // Add announcement status to tooltip details
        if (holiday.announcementSent) {
          details = `${details}\n\nAnnouncement sent`;
        }

        highlights[dateString] = {
          color: "#FF5722", // Distinctive color for holidays
          description: holiday.name,
          // Store additional information that can be used in the tooltip
          descriptionDetails: details || undefined,
          isHoliday: true,
        };
      });

      setHolidayHighlights(highlights);
    } catch (err) {
      console.error("Failed to fetch holidays:", err);
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
    fetchAttendance(selectedDate());
    fetchHolidays();
  });

  onMount(() => {
    // Store subscription reference to ensure proper cleanup
    let subscription: ReturnType<typeof api.attendance.attendanceChanged.subscribe> | null = null;
    
    const setupSubscription = () => {
      // Cancel any existing subscription first
      if (subscription) {
        subscription.unsubscribe();
      }
      
      // Create new subscription
      subscription = api.attendance.attendanceChanged.subscribe(undefined, {
        onData: (updated) => {
          if (
            isToday(selectedDate()) &&
            updated.data.userId === getUser()?.dbID
          ) {
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

  const handleDateChange = (date: Date) => {
    const currentYear = selectedDate().getFullYear();
    setSelectedDate(date);
    fetchAttendance(date);

    // If year changes, fetch holidays for the new year
    if (date.getFullYear() !== currentYear) {
      fetchHolidays(date.getFullYear().toString());
    }
  };

  // Get the current user data for the circular time tracker
  const overviewUser = () => {
    if (selectedUser()) {
      return (
        getAdmin()?.allUsers.find(
          (user) => user.dbID === selectedUser()!.dbID
        ) || getUser()
      );
    }
    return getUser();
  };

  // Update when selected user changes
  createEffect(() => {
    const user = selectedUser();
    if (user) {
      fetchAttendanceSummary(selectedDate(), user.dbID);
    }
  });

  // Function to refresh calendar data - used after operations
  const refreshCalendarData = async (date?: Date) => {
    const targetDate = date || selectedDate();
    await Promise.all([
      fetchHolidays(targetDate.getFullYear().toString()),
      fetchAttendance(targetDate),
    ]);
  };

  // Handler for completed leave selection from Calendar
  const handleLeaveRequestComplete = (dates: Date[]) => {
    setSelectedLeaveDates(dates);
    setLeaveModalOpen(true);
  };

  // Submit the leave request
  const handleLeaveConfirm = async (dates: Date[], reason: string) => {
    setLeaveModalOpen(false);
    setLoadingAttendance(true);

    try {
      // Call API to request leave with multiple dates
      await api.leaves.requestLeave.mutate({
        dates: dates.map((date) => date.toISOString()),
        reason: reason || undefined,
      });

      // Refresh calendar data
      await refreshCalendarData();
      toast.success("Leave request submitted successfully");
    } catch (error) {
      console.error("Failed to request leave:", error);
      toast.error("Failed to request leave. Please try again.");
    } finally {
      setLoadingAttendance(false);
    }
  };

  // Handle leave cancellation
  const handleCancelLeave = async (date: Date) => {
    try {
      setLoadingAttendance(true);
      await api.leaves.cancelLeave.mutate({ date: date.toISOString() });
      toast.success("Leave request cancelled successfully");
      refreshCalendarData();
    } catch (err) {
      console.error("Failed to cancel leave", err);
      toast.error("Failed to cancel leave request");
    }
  };

  const handleConvertToHoliday = async (date: Date) => {
    setLoadingAttendance(true);
    try {
      setSelectedHolidayDate(date);
      setHolidayModalOpen(true);
    } finally {
      setLoadingAttendance(false);
    }
  };

  const handleConvertToWorkday = async (date: Date) => {
    setLoadingAttendance(true);
    try {
      // Call API to convert back to workday
      await api.holidays.convertToWorkday.mutate({
        date: date.toISOString(),
      });

      // Refetch holidays and attendance after change
      await refreshCalendarData(date);
      toast.success(`Successfully converted to workday`);
    } catch (error) {
      console.error("Failed to convert to workday:", error);
      toast.error("Failed to convert to workday. Please try again.");
    } finally {
      setLoadingAttendance(false);
    }
  };

  const handleShiftHoliday = async (originalDate: Date, newDate: Date) => {
    setLoadingAttendance(true);
    try {
      // Call API to shift the holiday from original date to new date
      await api.holidays.shiftHoliday.mutate({
        originalDate: originalDate.toISOString(),
        newDate: newDate.toISOString(),
      });

      // Refresh calendar data to show the shifted holiday
      await refreshCalendarData(newDate);
      toast.success("Holiday shifted successfully");
    } catch (error) {
      console.error("Failed to shift holiday:", error);
      toast.error("Failed to shift holiday. Please try again.");
    } finally {
      setLoadingAttendance(false);
    }
  };

  const handleHolidayConfirm = async (name: string, description: string) => {
    // Close the modal
    setHolidayModalOpen(false);
    if (!selectedHolidayDate()) return;

    setLoadingAttendance(true);
    try {
      // Call API to convert to holiday with user-provided values
      await api.holidays.convertToHoliday.mutate({
        date: selectedHolidayDate()!.toISOString(),
        name: name,
        description: description || undefined,
      });

      // Refetch holidays and attendance after change
      await refreshCalendarData(selectedHolidayDate()!);
      toast.success(`Successfully created holiday: ${name}`);
    } catch (error) {
      console.error("Failed to convert to holiday:", error);
      toast.error("Failed to create holiday. Please try again.");
    } finally {
      setLoadingAttendance(false);
    }
  };

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
            weekendDays={[5, 6]}
            onSelect={handleDateChange}
            loading={loadingAttendance()}
            dateHighlights={dateHighlights()}
            monthStats={
              summary()
                ? {
                    absences: summary()!.stats.daysAbsent,
                    leavesTaken: summary()!.stats.daysOnLeave,
                  }
                : undefined
            }
            onLeaveRequestComplete={handleLeaveRequestComplete}
            onCancelLeave={handleCancelLeave}
            onConvertToHoliday={handleConvertToHoliday}
            onConvertToWorkday={handleConvertToWorkday}
            onShiftHoliday={handleShiftHoliday}
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
          <Show when={user() && user()!.attendance}>
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
            <CircularTimeTracking
              timeSegments={generateTimeSegments(overviewUser()!.attendance)}
              currentTime={currentTime()}
            />
          </Show>
        </div>
      </div>
      <Show when={leaveModalOpen()}>
        <LeaveRequestModal
          isOpen={true}
          dates={selectedLeaveDates()}
          onClose={() => setLeaveModalOpen(false)}
          onConfirm={handleLeaveConfirm}
        />
      </Show>
      <HolidayModal
        isOpen={holidayModalOpen()}
        onClose={() => setHolidayModalOpen(false)}
        onConfirm={handleHolidayConfirm}
        date={selectedHolidayDate() || new Date()}
      />
    </div>
  );
};
