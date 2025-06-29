import { useSearchParams } from "@solidjs/router";
import AttendanceOverview from "../components/AttendanceOverview";

export default function Home() {
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.date;
  let selectedDate = new Date();
  if (typeof dateParam === "string") {
    // Expect the string in the format "YYYY-MM-DD"
    const parts = dateParam.split("-");
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; // Months are zero-indexed in JavaScript
      const day = parseInt(parts[2], 10);
      selectedDate.setFullYear(year, month, day);
    } else {
      console.error("Invalid date format:", dateParam);
    }
  }

  console.log("Selected date:", selectedDate);

  return (
    <main class="flex h-auto min-h-screen flex-col items-center justify-center p-4">
      <AttendanceOverview date={selectedDate} />
    </main>
  );
}
