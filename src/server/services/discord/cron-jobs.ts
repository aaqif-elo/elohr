import { CronJob } from "cron";
import { Client, TextChannel } from "discord.js";
import {
  getDiscordIdsFromUserIds,
  getNextHoliday,
  getUsersOnLeave,
  isHoliday,
  syncHolidays,
  findMeetingsDueForReminder,
  notifyMeetingReminder,
  markReminderSent,
  getNextReminderCache,
  updateNextReminderCache,
  clearNextReminderCacheIfMatches,
  findNextMeetingForReminder,
} from "../../db";
import {
  announceHoliday,
  autoLogoutUsersWhoAreStillLoggedIn,
  getWeatherReport,
} from "./services";

enum CRON_TIMES {
  WEEKDAYS_AT_10_40_AM = "0 40 10 * * 0-4",
  EVERYDAY_AT_11_59_PM = "0 59 23 * * *",
  WEEKDAYS_AT_6_00_PM = "0 0 18 * * 0-4",
  DAILY_AT_2_00_AM = "0 0 2 * * *", // holiday sync
  EVERY_MINUTE = "0 * * * * *", // meeting reminders
}

const holidayAnnouncementJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.WEEKDAYS_AT_6_00_PM, callback);

const scrumReminderJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.WEEKDAYS_AT_10_40_AM, callback);

const autoLogoutPeopleOnABreakJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.EVERYDAY_AT_11_59_PM, callback);

const holidaySyncJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.DAILY_AT_2_00_AM, callback);

const meetingRemindersJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.EVERY_MINUTE, callback);

const production = process.env.NODE_ENV === "production";
const generalChannelID = production
  ? process.env.ANNOUNCEMENTS_CHANNEL_ID
  : process.env.TEST_CHANNEL_ID;

if (!generalChannelID)
  throw new Error("ANNOUNCEMENTS_CHANNEL_ID is not defined");

// Helper function to check if two dates are the same day
function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = new Date(date1);
  const d2 = new Date(date2);

  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

// Holiday announcement every weekday at 6:00 PM
const holidayAnnouncementHandler = async (discordClient: Client<boolean>) => {
  try {
    // Get tomorrow's date
    const today = new Date();
    const nextWorkDay = new Date(today);

    // If today is Thursday (4), set nextWorkDay to Sunday (skip Friday and Saturday)
    if (today.getDay() === 4) {
      // Thursday
      nextWorkDay.setDate(today.getDate() + 3); // Sunday
    } else {
      nextWorkDay.setDate(today.getDate() + 1); // Tomorrow
    }

    // Check if the next work day is a holiday
    const nextHoliday = await getNextHoliday(nextWorkDay);

    // Only announce if there's a holiday and it starts on the next work day
    if (nextHoliday && isSameDay(nextHoliday.startDate, nextWorkDay)) {
      await announceHoliday(discordClient, nextHoliday);
    }
  } catch (error) {
    console.error("Error in holiday announcement job:", error);
  }
};

export const startCronJobs = async (discordClient: Client<boolean>) => {
  // Meeting reminders: sweep DB every minute and on startup
  const processMeetingReminders = async () => {
    try {
      // If we have a cache and it's not time yet, skip DB call
      const cache = getNextReminderCache();
      const now = new Date();
      if (cache && cache.at.getTime() - now.getTime() > 30 * 1000) {
        return; // Next reminder is more than 30s away; skip sweep
      }

      const due = await findMeetingsDueForReminder(now);
      for (const meeting of due) {
        try {
          await notifyMeetingReminder(discordClient, meeting);
          await markReminderSent(meeting.id);
        } catch (e) {
          console.error("Error sending meeting reminder:", e);
        }
      }

      // Refresh cache with next upcoming meeting's reminder time
      const next = await findNextMeetingForReminder(now);
      if (next) {
        const reminderAt = new Date(next.startTime.getTime() - 10 * 60_000);
        if (reminderAt > now) updateNextReminderCache(reminderAt, next.id);
      } else {
        clearNextReminderCacheIfMatches();
      }
    } catch (e) {
      console.error("Meeting reminder sweep failed:", e);
    }
  };

  // Startup sweep
  processMeetingReminders();

  // Run every minute
  meetingRemindersJob(async () => {
    await processMeetingReminders();
  }).start();
  // Logout users on break every weekday at 11:59 PM
  autoLogoutPeopleOnABreakJob(async () => {
    autoLogoutUsersWhoAreStillLoggedIn(discordClient);
  }).start();

  // Holiday announcement job
  holidayAnnouncementJob(async () => {
    await holidayAnnouncementHandler(discordClient);
  }).start();

  // Daily holiday sync at 2:00 AM server time
  holidaySyncJob(async () => {
    try {
      const now = new Date();
      const currentYear = now.getFullYear();
      // Sync current year and next year (if near year end or start) to pre-populate changes
      await syncHolidays(currentYear);
      if (now.getMonth() === 11 || now.getMonth() === 0) {
        await syncHolidays(currentYear + (now.getMonth() === 11 ? 1 : -1));
      }
    } catch (err) {
      console.error("Error in holiday sync job:", err);
    }
  }).start();

  // Scrum reminder every weekday at 10:40 AM
  scrumReminderJob(async () => {
    const isHolidayResponse = await isHoliday();

    if (isHolidayResponse) {
      return;
    }

    const usersOnLeave = await getUsersOnLeave();
    const userIdDiscordIdObjects = await getDiscordIdsFromUserIds(usersOnLeave);
    console.log(usersOnLeave);
    let usersOnLeaveAnnouncement = `Users on leave today:\n\n`;
    userIdDiscordIdObjects.forEach((user) => {
      usersOnLeaveAnnouncement += `<@${user.discordId}>\n`;
    });
    console.log(usersOnLeaveAnnouncement, generalChannelID);
    const generalChannel = (await discordClient.channels.fetch(
      generalChannelID
    )) as TextChannel;
    const weatherReport = await getWeatherReport();
    if (!weatherReport) {
      console.error("Weather report is not available");
      return;
    }
    generalChannel.send({
      content: `@everyone\n${weatherReport}${
        usersOnLeave.length > 0 ? `\n\n${usersOnLeaveAnnouncement}` : ``
      }`,
    });
  }).start();
};
