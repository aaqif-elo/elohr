import { useSearchParams } from "@solidjs/router";
import AttendanceOverview from "../components/AttendanceOverview";

export default function Home() {
  const [searchParams] = useSearchParams();
  const dateParam = searchParams.date;
  let selectedDate = new Date();
  console.log("Date param:", dateParam);
  if (typeof dateParam === "string") {
    const date = new Date(dateParam);
    if (!isNaN(date.getTime())) {
      selectedDate = date;
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
