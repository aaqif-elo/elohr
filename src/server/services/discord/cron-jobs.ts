import { CronJob } from "cron";
import { Client, TextChannel } from "discord.js";
import {
  getDiscordIdsFromUserIds,
  getNextHoliday,
  getUsersOnLeave,
  isHoliday,
} from "../../db";
import {
  announceHoliday,
  autoLogoutUsersWhoAreStillLoggedIn,
  getWeatherReport,
} from "./services";

enum CRON_TIMES {
  WEEKDAYS_AT_10_40_AM = "0 40 10 * * 0-4",
  EVERYDAY_AT_11_59_PM = "0 59 23 * * *",
  WEDNESDAYS_AT_5_30_PM = "0 30 17 * * 3",
  WEEKDAYS_AT_6_00_PM = "0 0 18 * * 0-4",
}

const holidayAnnouncementJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.WEEKDAYS_AT_6_00_PM, callback);

const scrumReminderJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.WEEKDAYS_AT_10_40_AM, callback);

const autoLogoutPeopleOnABreakJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.EVERYDAY_AT_11_59_PM, callback);

const weeklyFormSubmissionReminderJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.WEDNESDAYS_AT_5_30_PM, callback);

const production = process.env.NODE_ENV === "production";
const generalChannelID = production
  ? process.env.GENERAL_CHANNEL_ID
  : process.env.TEST_CHANNEL_ID;

if (!generalChannelID) throw new Error("GENERAL_CHANNEL_ID is not defined");

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
  // Logout users on break every weekday at 11:59 PM
  autoLogoutPeopleOnABreakJob(async () => {
    autoLogoutUsersWhoAreStillLoggedIn(discordClient);
  }).start();

  // Holiday announcement job
  holidayAnnouncementJob(async () => {
    await holidayAnnouncementHandler(discordClient);
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

    generalChannel.send({
      content: `@everyone\n${weatherReport}${
        usersOnLeave.length > 0 ? `\n\n${usersOnLeaveAnnouncement}` : ``
      }`,
    });
  }).start();

  // Weekly form update reminder WEDNESDAYS_AT_5_30_PM
  weeklyFormSubmissionReminderJob(async () => {
    const isHolidayResponse = await isHoliday();

    if (isHolidayResponse) {
      return;
    }
    const generalChannel = (await discordClient.channels.fetch(
      generalChannelID
    )) as TextChannel;
    generalChannel.send({
      content: `**Final Reminder**\n\nThis is not about reporting what you've worked on, we have scrum meetings for that\n\n@everyone Please fill up the **\`weekly\`** form:\n\nhttps://docs.google.com/forms/d/e/1FAIpQLSfn4ToykETXdHrBIspAaAWhKRGiF48ZDSUm0Mf0xK9Stm0ohw/viewform\n\n#HappyWeekend\n\n\`Please do this with your heart\`\n\`STOP MISSING\``,
    });
  }).start();
};
