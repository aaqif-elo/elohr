import {
  createSignal,
  createMemo,
  Show,
  For,
  on,
  onMount,
} from "solid-js";
import { createStore } from "solid-js/store";
import "./Calendar.css";
import { getSystemTheme } from "./utils";
import { SpinningCircles } from "../SpinningCircles";


type CalendarDateParts = {
  day: number;
  month: number;
  year: number;
};



export enum Legends {
  workedWeekends = "#4CAF50",
  absences = "#E53935", // Red for absences
  others = "#9e9e9e", // Grey for other dates
}

export type DateHighlight = {
  color: Legends;
  description: string;
  descriptionDetails?: string;
  isAbsence?: boolean;
};

type MonthStats = {
  absences: number;
  [key: string]: number;
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

  // Handle date selection
  function handleSelectDate(day: number, month: number, year: number) {
    const newDate = new Date(year, month, day);
    setSelectedDate(newDate);
    props.onSelect?.(newDate);

    if (
      month !== currentDate().getMonth() ||
      year !== currentDate().getFullYear()
    ) {
      setCurrentDate(newDate);
    }
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

    // Count weekend days
    let weekends = 0;
    for (let day = 1; day <= totalDaysInMonth; day++) {
      const date = new Date(year, month, day);
      if (weekendDays().includes(date.getDay())) {
        weekends++;
      }
    }

    // Calculate total working days
    const totalWorkingDays = totalDaysInMonth - weekends;

    // Calculate working days till now
    const today = new Date();
    let workingDaysTillNow = 0;

    // Only calculate workingDaysTillNow if we're viewing the current month
    if (today.getMonth() === month && today.getFullYear() === year) {
      const currentDay = today.getDate();

      for (let day = 1; day <= currentDay; day++) {
        const date = new Date(year, month, day);
        if (!weekendDays().includes(date.getDay())) {
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
    };
  });

  // Get month details
  const monthData = createMemo(on([currentDate, () => props.dateHighlights], ([date]) => {
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
  }));

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
    if (!props.dateHighlights) return;

    const dateString = `${year}-${String(month + 1).padStart(2, "0")}-${String(
      day
    ).padStart(2, "0")}`;
    return props.dateHighlights[dateString];
  }

  function isAbsence(day: number, month: number, year: number): boolean {
    const highlight = getHighlight(day, month, year);
    return !!highlight?.isAbsence;
  }

  function isWorkingDay(day: number, month: number, year: number): boolean {
    return !isWeekend(day, month, year) && !isAbsence(day, month, year);
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
      case "workingDays":
        return isWorkingDay(day, month, year);
      case "workingDaysTillNow":
        return isWorkingDayTillNow(day, month, year);
      case "weekends":
        return isWeekend(day, month, year);
      case "absences":
        return isAbsence(day, month, year);
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
  function handleDayMouseOver(e: MouseEvent, dayInfo: CalendarDateParts) {
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
      }

      // Format the tooltip text with the description on a second line
      const tooltipText = highlight.description;

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

  function handleDayClick(dayInfo: CalendarDateParts) {
    if (props.loading) return;
    handleSelectDate(dayInfo.day, dayInfo.month, dayInfo.year);
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
              color={Legends.workedWeekends}
            />
            
            <StatItem
              category="absences"
              label="Absences"
              value={props.monthStats?.absences || 0}
              color={Legends.absences}
            />
          </div>

        </div>

        <div class="hr-calendar-main">
          {/* Keep existing header and weekdays sections */}
          <div class="hr-calendar-header">
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
                      absence: highlight?.isAbsence,
                      past: !isFutureOrToday,
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
                    }}
                    style={{
                      "background-color": highlight
                        ? `${highlight.color}30`
                        : undefined,
                      "border-color": highlight ? highlight.color : undefined,
                    }}
                    onClick={() => handleDayClick(dayInfo)}
                    onMouseOver={(e) => handleDayMouseOver(e, dayInfo)}
                    onMouseOut={hideTooltip}
                  >
                    {dayInfo.day}
                  </div>
                );
              }}
            </For>
          </div>
        </div>
      </div>

      {/* Loading overlay and tooltip */}
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
          // eslint-disable-next-line solid/no-innerhtml
          innerHTML={hoverInfo.text}
         />
      </Show>
    </div>
  );
}
