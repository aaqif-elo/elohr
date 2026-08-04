import { CronJob } from "cron";
import type { Client } from "discord.js";
import {
  sendWeeklyAttendanceReportToAdmin,
  sendWeeklyProjectReportsToManagers,
} from "./services";

enum CRON_TIMES {
  EVERYDAY_AT_11_59_PM = "0 59 23 * * *",
}

export const startCronJobs = async (discordClient: Client<boolean>) => {
  // Every Thursday at 11:59 PM: weekly attendance report to the admin channel,
  // and a per-project weekly report DM'd to each project's manager.
  new CronJob(CRON_TIMES.EVERYDAY_AT_11_59_PM, async () => {
    const isThursday = new Date().getDay() === 4;
    if (!isThursday) return;

    try {
      await sendWeeklyAttendanceReportToAdmin(discordClient);
    } catch (err) {
      console.error("Failed to send weekly attendance report:", err);
    }

    try {
      await sendWeeklyProjectReportsToManagers(discordClient);
    } catch (err) {
      console.error("Failed to send weekly project reports:", err);
    }
  }).start();
};
