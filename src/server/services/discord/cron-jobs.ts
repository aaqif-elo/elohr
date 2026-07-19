import { CronJob } from "cron";
import type { Client } from "discord.js";
import {
  autoLogoutUsersWhoAreStillLoggedIn,
  sendWeeklyAttendanceReportToAdmin,
} from "./services";

enum CRON_TIMES {
  EVERYDAY_AT_11_59_PM = "0 59 23 * * *",
}

const autoLogoutJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.EVERYDAY_AT_11_59_PM, callback);

export const startCronJobs = async (discordClient: Client<boolean>) => {
  // Auto-logout every day at 11:59 PM; generate weekly report on Thursdays
  autoLogoutJob(async () => {
    const isThursday = new Date().getDay() === 4;

    await autoLogoutUsersWhoAreStillLoggedIn(discordClient);

    if (isThursday) {
      try {
        await sendWeeklyAttendanceReportToAdmin(discordClient);
      } catch (err) {
        console.error("Failed to send weekly attendance report:", err);
      }
    }
  }).start();
};
