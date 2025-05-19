import {
  createSignal,
  createMemo,
  createEffect,
  Show,
  For,
  onMount,
  onCleanup,
} from "solid-js";
import { createStore } from "solid-js/store";
import "./Calendar.css";
import { getSystemTheme } from "./utils";
import { SpinningCircles } from "../SpinningCircles";

// Add imports for dropdown menu icon
import { FiMoreVertical } from "solid-icons/fi";
import { UserRoleTypes } from "@prisma/client";
import { getUser } from "../../store";
import toast from "solid-toast";

// Menu item type for our dropdown
type MenuAction = {
  label: string;
  action: (date: Date) => void | Promise<void>;
};



export enum Legends {
  workedHolidaysOrWeekends = "#4CAF50", // Green for worked holidays
  leaves = "#FFA726", // Orange for leaves
  absences = "#E53935", // Red for absences
  holidays = "#9C27B0", // Purple for holidays
  others = "#9e9e9e", // Grey for other dates
}

export type DateHighlight = {
  color: Legends;
  description: string;
  descriptionDetails?: string; // Added field for detailed description
  isHoliday?: boolean; // Added isHoliday flag to identify holidays
  isAbsence?: boolean; // Add flag for absences
  isLeave?: boolean; // Add flag for leaves taken
};

// Updated MonthStats to only include stats we can't calculate
type MonthStats = {
  absences: number;
  leavesTaken: number;
  [key: string]: number; // Allow for custom stats
};

type HRCalendarProps = {
  /**
   * Initial selected date
   */
  initialDate?: Date;

  /**
   * Callback triggered when a date is selected
   */
  onSelect?: (date: Date) => void;

  /**
   * Custom highlight data for specific dates
   * Keys should be in YYYY-MM-DD format
   */
  dateHighlights?: Record<string, DateHighlight>;

  /**
   * Custom weekend days (0 = Sunday, 6 = Saturday)
   * Default: [0, 6]
   */
  weekendDays?: number[];

  /**
   * Stats for the displayed month
   */
  monthStats?: MonthStats;

  /**
   * Whether the calendar is in loading state
   */
  loading?: boolean;

  // Add new props for context menu actions
  onConvertToHoliday?: (date: Date) => void | Promise<void>;
  onConvertToWorkday?: (date: Date) => void | Promise<void>;
  onShiftHoliday?: (originalDate: Date, newDate: Date) => void | Promise<void>;

  // Add new prop for cancelling leave
  onCancelLeave?: (date: Date) => void | Promise<void>;

  /**
   * Callback when user completes leave date selection
   * Receives array of selected dates
   */
  onLeaveRequestComplete?: (dates: Date[]) => void;
};

export function HRCalendar(props: HRCalendarProps) {
  // Initialize with current date if not provided
  const [currentDate, setCurrentDate] = createSignal(
    props.initialDate || new Date()
  );
  const [selectedDate, setSelectedDate] = createSignal(
    props.initialDate || new Date()
  );
  const [hoverInfo, setHoverInfo] = createStore({
    visible: false,
    text: "",
    x: 0,
    y: 0,
  });

  const [theme, setTheme] = createSignal(getSystemTheme());

  // Add new state for tracking hovered stat category
  const [hoveredCategory, setHoveredCategory] = createSignal<string | null>(
    null
  );

  // New state for dropdown menu
  const [menuOpen, setMenuOpen] = createSignal<{
    date: Date;
    x: number;
    y: number;
  } | null>(null);

  // Add new state for shift holiday mode
  const [shiftHolidayMode, setShiftHolidayMode] = createSignal(false);
  const [holidayToShift, setHolidayToShift] = createSignal<{
    date: Date;
    name: string;
  } | null>(null);

  // Add new state for leave selection
  const [leaveSelectionMode, setLeaveSelectionMode] = createSignal(false);
  const [selectedLeaveDates, setSelectedLeaveDates] = createSignal<Date[]>([]);

  // Check if user is admin
  const isUserAdmin = () => {
    const user = getUser();
    return user?.roles.includes(UserRoleTypes.ADMIN) || false;
  };

  // Check if a date is in the future or today
  function isCurrentOrFuture(
    day: number,
    month: number,
    year: number
  ): boolean {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const date = new Date(year, month, day);
    return date >= today;
  }

  // Helper function to format date as YYYY-MM-DD
  function formatDateToYYYYMMDD(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  // Get available menu actions for a date
  function getMenuActions(date: Date): MenuAction[] {
    const actions: MenuAction[] = [];
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    const isPastDate = date < currentDate;
    const formattedDate = formatDateToYYYYMMDD(date);
    const highlight = props.dateHighlights?.[formattedDate];

    const isHolidayDate = highlight?.isHoliday === true;
    const isWeekendDate = isWeekend(
      date.getDate(),
      date.getMonth(),
      date.getFullYear()
    );

    // Replace onRequestLeave with internal handler
    if (!isPastDate && !isHolidayDate && !isWeekendDate) {
      actions.push({
        label: "Request Leave",
        action: () => {
          // Start leave selection mode
          setSelectedLeaveDates([date]);
          setLeaveSelectionMode(true);
        },
      });
    }

    // Add cancel leave action for dates with existing leave requests
    if (props.onCancelLeave && !isPastDate) {
      if (highlight?.isLeave) {
        actions.push({
          label: "Cancel leave request",
          action: async (date) => {
            props.onCancelLeave?.(date);
          },
        });
      }
    }

    // Admin-only actions
    if (isUserAdmin()) {
      // Add holiday and workday conversion options if it's a future date
      if (!isPastDate) {
        // Allow converting to holiday if it's not already a holiday
        if (!isHolidayDate && props.onConvertToHoliday) {
          actions.push({
            label: "Mark as holiday",
            action: props.onConvertToHoliday,
          });
        }

        // Allow converting to workday if it's currently a holiday
        if (isHolidayDate && props.onConvertToWorkday) {
          actions.push({
            label: "Mark as regular workday",
            action: props.onConvertToWorkday,
          });
        }

        // Allow shifting holiday if it's currently a holiday
        if (isHolidayDate && props.onShiftHoliday) {
          actions.push({
            label: "Shift holiday to another date",
            action: (date) => {
              setHolidayToShift({
                date,
                name: highlight?.description || "Holiday",
              });
              setShiftHolidayMode(true);
            },
          });
        }
      }
    }

    return actions;
  }

  // Open menu dropdown
  function openMenu(e: MouseEvent, day: number, month: number, year: number) {
    e.stopPropagation();
    const date = new Date(year, month, day);

    // Check if menu is already open for this date
    const currentMenu = menuOpen();
    if (
      currentMenu &&
      currentMenu.date.getDate() === date.getDate() &&
      currentMenu.date.getMonth() === date.getMonth() &&
      currentMenu.date.getFullYear() === date.getFullYear()
    ) {
      // If clicking the same date's menu icon again, close the menu
      closeMenu();
    } else {
      // Open menu for a new date
      setMenuOpen({
        date,
        x: e.clientX,
        y: e.clientY,
      });
    }
  }

  // Close menu dropdown
  function closeMenu() {
    setMenuOpen(null);
  }

  // Add global click handler to close menu when clicking outside
  createEffect(() => {
    if (menuOpen()) {
      const handleOutsideClick = (e: MouseEvent) => {
        // Check if click target is part of the menu
        const menuElement = document.querySelector(".day-menu-dropdown");
        if (menuElement && !menuElement.contains(e.target as Node)) {
          closeMenu();
        }
      };

      // Add the event listener to document
      document.addEventListener("click", handleOutsideClick);

      // Clean up when menu closes
      onCleanup(() => {
        document.removeEventListener("click", handleOutsideClick);
      });
    }
  });

  // Handle menu action
  function handleMenuAction(action: MenuAction) {
    if (menuOpen()) {
      action.action(menuOpen()!.date);
      closeMenu();
    }
  }

  // Add function to check if a date is valid for shifting to
  function isValidWorkDay(day: number, month: number, year: number): boolean {
    // Must be a future date or today
    if (!isCurrentOrFuture(day, month, year)) {
      return false;
    }

    // Must not be a weekend
    if (isWeekend(day, month, year)) {
      return false;
    }

    // Must not be a holiday already
    if (isHoliday(day, month, year)) {
      return false;
    }

    return true;
  }

  // Add function to toggle date selection
  function toggleDateSelection(date: Date) {
    setSelectedLeaveDates((prev) => {
      const dateStr = formatDateToYYYYMMDD(date);
      const existingIndex = prev.findIndex(
        (d) => formatDateToYYYYMMDD(d) === dateStr
      );

      if (existingIndex >= 0) {
        // Remove date if already selected
        return [
          ...prev.slice(0, existingIndex),
          ...prev.slice(existingIndex + 1),
        ];
      } else {
        // Add date if not selected
        return [...prev, date];
      }
    });
  }

  // Modify handleSelectDate to handle shift holiday mode
  function handleSelectDate(day: number, month: number, year: number) {
    if (shiftHolidayMode() || leaveSelectionMode()) {
      // If we're in shift mode, check if this is a valid target
      if (isValidWorkDay(day, month, year)) {
        const newDate = new Date(year, month, day);
        if (shiftHolidayMode()) {
          // Complete the shift with both dates
          if (holidayToShift() && props.onShiftHoliday) {
            props.onShiftHoliday(holidayToShift()!.date, newDate);
          }
          // Exit shift mode
          setShiftHolidayMode(false);
          setHolidayToShift(null);
        } else {
          // Toggle date selection for leave mode
          toggleDateSelection(newDate);
        }
      }
      // Do nothing if invalid target during shift mode
      return;
    }

    // Regular date selection logic
    const newDate = new Date(year, month, day);
    setSelectedDate(newDate);
    props.onSelect?.(newDate);

    // If selected date is not in current month view, update the view
    if (
      month !== currentDate().getMonth() ||
      year !== currentDate().getFullYear()
    ) {
      setCurrentDate(newDate);
    }
  }

  // Add ESC key handler to cancel shift mode
  createEffect(() => {
    if (shiftHolidayMode()) {
      const handleEscKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setShiftHolidayMode(false);
          setHolidayToShift(null);
        }
      };

      window.addEventListener("keydown", handleEscKey);

      onCleanup(() => {
        window.removeEventListener("keydown", handleEscKey);
      });
    }
  });

  // Add completion handlers
  function completeLeaveSelection() {
    const dates = selectedLeaveDates();
    if (dates.length === 0) {
      toast.error("Please select at least one date for leave");
      return;
    }

    // Sort dates chronologically
    const sortedDates = [...dates].sort((a, b) => a.getTime() - b.getTime());

    // Send selected dates to parent component
    props.onLeaveRequestComplete?.(sortedDates);

    // Reset selection state
    resetLeaveSelection();
  }

  function cancelLeaveSelection() {
    resetLeaveSelection();
  }

  function resetLeaveSelection() {
    setLeaveSelectionMode(false);
    setSelectedLeaveDates([]);
  }

  // Update theme if system preference changes
  onMount(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = () => {
      setTheme(getSystemTheme());
    };

    mediaQuery.addEventListener("change", handleChange);

    // Cleanup listener on component unmount
    return () => mediaQuery.removeEventListener("change", handleChange);
  });

  // Default weekend days (Sunday and Saturday)
  const weekendDays = () => props.weekendDays || [0, 6];

  // Calculate month statistics automatically
  const calculatedStats = createMemo(() => {
    const date = currentDate();
    const year = date.getFullYear();
    const month = date.getMonth();

    // Get total days in the month
    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

    // Count holidays in the month
    let holidays = 0;
    if (props.dateHighlights) {
      for (let day = 1; day <= totalDaysInMonth; day++) {
        const dateString = `${year}-${String(month + 1).padStart(
          2,
          "0"
        )}-${String(day).padStart(2, "0")}`;
        const highlight = props.dateHighlights[dateString];
        if (highlight && highlight.isHoliday) {
          holidays++;
        }
      }
    }

    // Count weekend days
    let weekends = 0;
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const date = new Date(year, month, day);
      if (weekendDays().includes(date.getDay())) {
        weekends++;
      }
    }

    // Calculate total working days
    const totalWorkingDays = totalDaysInMonth - holidays - weekends;

    // Calculate working days till now
    const today = new Date();
    let workingDaysTillNow = 0;

    // Only calculate workingDaysTillNow if we're viewing the current month
    if (today.getMonth() === month && today.getFullYear() === year) {
      const currentDay = today.getDate();

      for (let day = 1; day <= currentDay; day++) {
        const date = new Date(year, month, day);
        const dateString = `${year}-${String(month + 1).padStart(
          2,
          "0"
        )}-${String(day).padStart(2, "0")}`;
        const highlight = props.dateHighlights?.[dateString];

        // Skip weekends and holidays
        if (
          !weekendDays().includes(date.getDay()) &&
          !(highlight && highlight.isHoliday)
        ) {
          workingDaysTillNow++;
        }
      }
    } else if (
      today.getFullYear() > year ||
      (today.getFullYear() === year && today.getMonth() > month)
    ) {
      // If viewing a past month, all working days are "till now"
      workingDaysTillNow = totalWorkingDays;
    } else {
      // If viewing a future month, no working days are "till now"
      workingDaysTillNow = 0;
    }

    return {
      totalWorkingDays,
      workingDaysTillNow,
      holidays,
    };
  });

  // Get month details
  const monthData = createMemo(() => {
    // Add this line to create a dependency on props.dateHighlights
    const highlights = props.dateHighlights;

    const date = currentDate();
    const year = date.getFullYear();
    const month = date.getMonth();

    // First day of month
    const firstDay = new Date(year, month, 1);
    const startingDayOfWeek = firstDay.getDay();

    // Last day of month
    const lastDay = new Date(year, month + 1, 0);
    const totalDays = lastDay.getDate();

    // Days from previous month to fill the first row
    const previousMonthDays = startingDayOfWeek;

    // Calculate days from previous month
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    const prevMonthDays = Array.from({ length: previousMonthDays }, (_, i) => ({
      day: prevMonthLastDay - previousMonthDays + i + 1,
      month: month - 1 < 0 ? 11 : month - 1,
      year: month - 1 < 0 ? year - 1 : year,
      currentMonth: false,
    }));

    // Current month days
    const currentMonthDays = Array.from({ length: totalDays }, (_, i) => ({
      day: i + 1,
      month,
      year,
      currentMonth: true,
    }));

    // Combine days
    const allDays = [...prevMonthDays, ...currentMonthDays];

    // Add days from next month to complete the grid (6 rows x 7 days)
    const nextMonthDays = Array.from(
      { length: 42 - allDays.length },
      (_, i) => ({
        day: i + 1,
        month: month + 1 > 11 ? 0 : month + 1,
        year: month + 1 > 11 ? year + 1 : year,
        currentMonth: false,
      })
    );

    return [...allDays, ...nextMonthDays];
  });

  // Check if a date is selected
  function isSelected(day: number, month: number, year: number): boolean {
    const selected = selectedDate();
    return (
      selected.getDate() === day &&
      selected.getMonth() === month &&
      selected.getFullYear() === year
    );
  }

  // Check if a date is today
  function isToday(day: number, month: number, year: number): boolean {
    const today = new Date();
    return (
      today.getDate() === day &&
      today.getMonth() === month &&
      today.getFullYear() === year
    );
  }

  // Check if a date is a weekend
  function isWeekend(day: number, month: number, year: number): boolean {
    const date = new Date(year, month, day);
    return weekendDays().includes(date.getDay());
  }

  // Get date highlight information
  function getHighlight(
    day: number,
    month: number,
    year: number
  ): DateHighlight | undefined {
    if (!props.dateHighlights) return undefined;

    const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    return props.dateHighlights[dateString];
  }

  // Helper functions to determine if a date belongs to a specific category
  function isHoliday(day: number, month: number, year: number): boolean {
    const highlight = getHighlight(day, month, year);
    return !!highlight?.isHoliday;
  }

  function isAbsence(day: number, month: number, year: number): boolean {
    const highlight = getHighlight(day, month, year);
    return !!highlight?.isAbsence;
  }

  function isLeave(day: number, month: number, year: number): boolean {
    const highlight = getHighlight(day, month, year);
    return !!highlight?.isLeave;
  }

  function isWorkingDay(day: number, month: number, year: number): boolean {
    return (
      !isWeekend(day, month, year) &&
      !isHoliday(day, month, year) &&
      !isAbsence(day, month, year) &&
      !isLeave(day, month, year)
    );
  }

  function isWorkingDayTillNow(
    day: number,
    month: number,
    year: number
  ): boolean {
    const today = new Date();
    const date = new Date(year, month, day);
    return (
      isWorkingDay(day, month, year) &&
      (date <= today ||
        today.getFullYear() > year ||
        (today.getFullYear() === year && today.getMonth() > month))
    );
  }

  // Check if a date matches the currently hovered category
  function matchesHoveredCategory(
    day: number,
    month: number,
    year: number
  ): boolean {
    const category = hoveredCategory();
    if (!category) return false;

    switch (category) {
      case "holidays":
        return isHoliday(day, month, year);
      case "workingDays":
        return isWorkingDay(day, month, year);
      case "workingDaysTillNow":
        return isWorkingDayTillNow(day, month, year);
      case "weekends":
        return isWeekend(day, month, year);
      case "absences":
        return isAbsence(day, month, year);
      case "leavesTaken":
        return isLeave(day, month, year);
      default:
        return false;
    }
  }

  // Navigation functions
  function goToPreviousMonth() {
    const date = new Date(currentDate());
    date.setMonth(date.getMonth() - 1);
    setCurrentDate(date);
    // Set selected date to the 1st of the new month and notify parent
    const newSelectedDate = new Date(date.getFullYear(), date.getMonth(), 1);
    setSelectedDate(newSelectedDate);
    props.onSelect?.(newSelectedDate);
  }

  function goToNextMonth() {
    const date = new Date(currentDate());
    date.setMonth(date.getMonth() + 1);
    setCurrentDate(date);
    // Set selected date to the 1st of the new month and notify parent
    const newSelectedDate = new Date(date.getFullYear(), date.getMonth(), 1);
    setSelectedDate(newSelectedDate);
    props.onSelect?.(newSelectedDate);
  }

  function goToPreviousYear() {
    const date = new Date(currentDate());
    date.setFullYear(date.getFullYear() - 1);
    setCurrentDate(date);
    // Set selected date to the 1st of the new month/year and notify parent
    const newSelectedDate = new Date(date.getFullYear(), date.getMonth(), 1);
    setSelectedDate(newSelectedDate);
    props.onSelect?.(newSelectedDate);
  }

  function goToNextYear() {
    const date = new Date(currentDate());
    date.setFullYear(date.getFullYear() + 1);
    setCurrentDate(date);
    // Set selected date to the 1st of the new month/year and notify parent
    const newSelectedDate = new Date(date.getFullYear(), date.getMonth(), 1);
    setSelectedDate(newSelectedDate);
    props.onSelect?.(newSelectedDate);
  }

  // Hide tooltip when mouse leaves
  function hideTooltip() {
    setHoverInfo("visible", false);
    setHoveredCategory(null);
  }

  // Add handlers for stat hover
  function handleStatHover(category: string) {
    setHoveredCategory(category);
  }

  function handleStatLeave() {
    setHoveredCategory(null);
  }

  // Fix issue with highlighting by updating the onMouseOver handler
  function handleDayMouseOver(e: MouseEvent, dayInfo: any) {
    if (props.loading) return;

    const day = dayInfo.day;
    const month = dayInfo.month;
    const year = dayInfo.year;
    const highlight = getHighlight(day, month, year);
    // Check for special date types FIRST - before checking if it's a weekend
    // This ensures absences and other special dates always get highlighted correctly
    if (highlight) {
      if (highlight.isAbsence) {
        setHoveredCategory("absences");
      } else if (highlight.isHoliday) {
        setHoveredCategory("holidays");
      } else if (highlight.isLeave) {
        setHoveredCategory("leavesTaken");
      }

      // Format the tooltip text with the description on a second line
      let tooltipText = highlight.description;

      // If there's a description, add it on a second line with styling
      if (highlight.description && highlight.descriptionDetails) {
        const tooltipHTML = `${highlight.description}<span class="tooltip-description">${highlight.descriptionDetails}</span>`;

        // Set tooltip content and position
        setHoverInfo({
          visible: true,
          text: tooltipHTML,
          x: e.clientX + 10,
          y: e.clientY + 10,
        });
      } else {
        // Regular single-line tooltip
        setHoverInfo({
          visible: true,
          text: tooltipText,
          x: e.clientX + 10,
          y: e.clientY + 10,
        });
      }
      return; // Return early after handling highlighted days
    }

    // Only check for weekend AFTER checking for highlights
    if (isWeekend(day, month, year)) {
      // Don't set category for plain weekends (no highlights)
      return;
    } else if (isWorkingDay(day, month, year)) {
      if (isWorkingDayTillNow(day, month, year)) {
        setHoveredCategory("workingDaysTillNow");
      } else {
        setHoveredCategory("workingDays");
      }
    }
  }

  // Add this helper function inside the HRCalendar component
  function StatItem(props: {
    category: string;
    label: string;
    value: number;
    color: string;
  }) {
    return (
      <div
        class="stat-item"
        classList={{
          "hover-highlight": hoveredCategory() === props.category,
          dimmed:
            hoveredCategory() !== null &&
            hoveredCategory() !== props.category,
        }}
        onMouseEnter={() => handleStatHover(props.category)}
        onMouseLeave={handleStatLeave}
        style={{ "border-left-color": props.color }}
      >
        <div class="stat-content">
          <div class="stat-label">{props.label}</div>
          <div class="stat-value">{props.value}</div>
        </div>
      </div>
    );
  }

  return (
    <div
      class={`hr-calendar ${theme() === "dark" ? "dark-mode" : "light-mode"}`}
    >
      {/* Leave selection mode prompt */}
      <Show when={leaveSelectionMode()}>
        <div class="shift-holiday-prompt">
          <div>
            <span>
              Select dates for leave request ({selectedLeaveDates().length}{" "}
              selected)
            </span>
            <div class="text-xs opacity-80">
              Click on dates to select/deselect
            </div>
          </div>
          <div class="flex gap-2">
            <button
              type="button"
              onClick={cancelLeaveSelection}
              class="shift-cancel-btn"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={completeLeaveSelection}
              class="shift-cancel-btn"
            >
              Done
            </button>
          </div>
        </div>
      </Show>
      <div class="hr-calendar-container">
        {/* Stats section */}
        <div class="hr-calendar-stats">
          <h3>Month Statistics</h3>
          <div class="stats-grid">
            <StatItem 
              category="workingDays"
              label="Working Days (Total)"
              value={calculatedStats().totalWorkingDays}
              color={Legends.others}
            />
            
            <StatItem 
              category="workingDaysTillNow"
              label="Working Days (Till Now)"
              value={calculatedStats().workingDaysTillNow}
              color={Legends.workedHolidaysOrWeekends}
            />
            
            <StatItem 
              category="holidays"
              label="Holidays"
              value={calculatedStats().holidays}
              color={Legends.holidays}
            />
            
            <StatItem 
              category="absences"
              label="Absences"
              value={props.monthStats?.absences || 0}
              color={Legends.absences}
            />
            
            <StatItem 
              category="leavesTaken"
              label="Leaves Taken"
              value={props.monthStats?.leavesTaken || 0}
              color={Legends.leaves}
            />
          </div>

          {/* Add shift mode indicator in stats panel */}
          <Show when={shiftHolidayMode()}>
            <div class="shift-status-indicator">
              <p>Shifting holiday: "{holidayToShift()?.name}"</p>
              <p class="shift-instructions">
                Navigate to any month and select a valid date
              </p>
              <button
                type="button"
                class="shift-cancel-btn"
                onClick={() => {
                  setShiftHolidayMode(false);
                  setHolidayToShift(null);
                }}
              >
                Cancel
              </button>
            </div>
          </Show>
        </div>

        <div class="hr-calendar-main">
          {/* Keep existing header and weekdays sections */}
          <div class="hr-calendar-header">
            {/* Move the shift prompt here instead of at the top level */}
            <Show when={shiftHolidayMode()}>
              <div class="shift-holiday-indicator">
                Shifting: "{holidayToShift()?.name}"
              </div>
            </Show>
            <div class="hr-calendar-navigation">
              <button
                type="button"
                onClick={goToPreviousYear}
                title="Previous Year"
                disabled={props.loading}
              >
                «
              </button>
              <button
                type="button"
                onClick={goToPreviousMonth}
                title="Previous Month"
                disabled={props.loading}
              >
                ‹
              </button>
              <div class="hr-calendar-title">
                {currentDate().toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
              </div>
              <button
                type="button"
                onClick={goToNextMonth}
                title="Next Month"
                disabled={props.loading}
              >
                ›
              </button>
              <button
                type="button"
                onClick={goToNextYear}
                title="Next Year"
                disabled={props.loading}
              >
                »
              </button>
            </div>
          </div>

          <div class="hr-calendar-weekdays">
            <div>Sun</div>
            <div>Mon</div>
            <div>Tue</div>
            <div>Wed</div>
            <div>Thu</div>
            <div>Fri</div>
            <div>Sat</div>
          </div>

          <div class="hr-calendar-grid">
            <For each={monthData()}>
              {(dayInfo) => {
                const highlight = getHighlight(
                  dayInfo.day,
                  dayInfo.month,
                  dayInfo.year
                );
                const isWeekendDay = isWeekend(
                  dayInfo.day,
                  dayInfo.month,
                  dayInfo.year
                );
                const isFutureOrToday = isCurrentOrFuture(
                  dayInfo.day,
                  dayInfo.month,
                  dayInfo.year
                );
                const isAnnounced = highlight?.descriptionDetails
                  ?.toLowerCase()
                  ?.includes("announce");
                const showMenuIcon = createMemo(() => {
                  return (
                    !isWeekendDay &&
                    isFutureOrToday &&
                    !(shiftHolidayMode() || leaveSelectionMode())
                  );
                });
                const isValidTarget = createMemo(() => {
                  if (
                    !isValidWorkDay(dayInfo.day, dayInfo.month, dayInfo.year)
                  ) {
                    return false;
                  }
                  return shiftHolidayMode() || leaveSelectionMode();
                });

                const isSelectedForLeave = createMemo(() => {
                  return selectedLeaveDates().some(
                    (date) =>
                      date.getDate() === dayInfo.day &&
                      date.getMonth() === dayInfo.month &&
                      date.getFullYear() === dayInfo.year
                  );
                });
                return (
                  <div
                    class="hr-calendar-day"
                    classList={{
                      "current-month": dayInfo.currentMonth,
                      "other-month": !dayInfo.currentMonth,
                      selected: isSelected(
                        dayInfo.day,
                        dayInfo.month,
                        dayInfo.year
                      ),
                      today: isToday(dayInfo.day, dayInfo.month, dayInfo.year),
                      weekend: isWeekendDay,
                      highlighted: !!highlight,
                      holiday: highlight?.isHoliday,
                      absence: highlight?.isAbsence,
                      leave: highlight?.isLeave,
                      past: !isFutureOrToday,
                      announced: isAnnounced,
                      // Other existing classes...
                      "hover-highlight": matchesHoveredCategory(
                        dayInfo.day,
                        dayInfo.month,
                        dayInfo.year
                      ),
                      dimmed:
                        hoveredCategory() !== null &&
                        !matchesHoveredCategory(
                          dayInfo.day,
                          dayInfo.month,
                          dayInfo.year
                        ) &&
                        !isWeekendDay,
                      "has-menu": showMenuIcon(), // Hide menu during shift mode
                      "shift-target": isValidTarget(), // Highlight valid shift targets
                      "shift-invalid":
                        (shiftHolidayMode() || leaveSelectionMode()) &&
                        !isValidTarget(), // Dim invalid targets during shift
                      "leave-selected": isSelectedForLeave(),
                    }}
                    style={{
                      "background-color": highlight
                        ? `${highlight.color}30`
                        : undefined,
                      "border-color": highlight ? highlight.color : undefined,
                    }}
                    onClick={() =>
                      !props.loading &&
                      handleSelectDate(dayInfo.day, dayInfo.month, dayInfo.year)
                    }
                    onMouseOver={(e) => handleDayMouseOver(e, dayInfo)}
                    onMouseOut={hideTooltip}
                  >
                    {dayInfo.day}

                    {/* Add announcement indicator for holidays */}
                    {isAnnounced && highlight?.isHoliday && (
                      <div
                        class="announcement-indicator"
                        title="Holiday announced to team"
                      >
                        📢
                      </div>
                    )}

                    {/* Menu icon for non-weekend future/today dates */}
                    {showMenuIcon() && (
                      <div
                        class="day-menu-icon"
                        onClick={(e) =>
                          openMenu(e, dayInfo.day, dayInfo.month, dayInfo.year)
                        }
                      >
                        <FiMoreVertical />
                      </div>
                    )}
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </div>

      {/* Add dropdown menu */}
      <Show when={menuOpen()}>
        <div
          class="day-menu-dropdown"
          style={{
            left: `${menuOpen()?.x}px`,
            top: `${menuOpen()?.y}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <ul>
            <For each={getMenuActions(menuOpen()!.date)}>
              {(action) => (
                <li onClick={() => handleMenuAction(action)}>{action.label}</li>
              )}
            </For>
          </ul>
        </div>
      </Show>

      {/* Keep existing loading overlay and tooltip */}
      <Show when={props.loading}>
        <div class="hr-calendar-loading-overlay">
          <SpinningCircles />
        </div>
      </Show>

      <Show when={hoverInfo.visible}>
        <div
          class="hr-calendar-tooltip"
          style={{
            left: `${hoverInfo.x}px`,
            top: `${hoverInfo.y}px`,
          }}
          innerHTML={hoverInfo.text}
        ></div>
      </Show>
    </div>
  );
}
