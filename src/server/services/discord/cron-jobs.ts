import { CronJob } from "cron";
import type { Client } from "discord.js";
import { sendWeeklyAttendanceReportToAdmin } from "./services";

enum CRON_TIMES {
  EVERYDAY_AT_11_59_PM = "0 59 23 * * *",
}

export const startCronJobs = async (discordClient: Client<boolean>) => {
  // Send weekly attendance report to admin channel every Thursday at 11:59 PM
  new CronJob(CRON_TIMES.EVERYDAY_AT_11_59_PM, async () => {
    const isThursday = new Date().getDay() === 4;
    if (isThursday) {
      try {
        await sendWeeklyAttendanceReportToAdmin(discordClient);
      } catch (err) {
        console.error("Failed to send weekly attendance report:", err);
      }
    }
  }).start();
};
