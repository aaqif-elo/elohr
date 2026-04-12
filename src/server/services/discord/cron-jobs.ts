import { CronJob } from "cron";
import type { Client, TextChannel } from "discord.js";
import {
  getAllActiveEmployeeDiscordIds,
  getDailyAttendanceAwardWinners,
  getDiscordIdsFromUserIds,
  getNextHoliday,
  getUsersOnLeave,
  isHoliday,
  syncHolidays,
} from "../../db";
import {
  clearDailyAwardEmojisForUsers,
  setDailyAwardEmoji,
} from "./utils";
import {
  announceHoliday,
  autoLogoutUsersWhoAreStillLoggedIn,
  getWeatherReport,
  sendWeeklyAttendanceReportToAdmin,
} from "./services";

enum CRON_TIMES {
  WEEKDAYS_AT_10_40_AM = "0 40 10 * * 0-4",
  EVERYDAY_AT_11_59_PM = "0 59 23 * * *",
  WEEKDAYS_AT_6_00_PM = "0 0 18 * * 0-4",
  DAILY_AT_2_00_AM = "0 0 2 * * *", // holiday sync
}

const holidayAnnouncementJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.WEEKDAYS_AT_6_00_PM, callback);

const scrumReminderJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.WEEKDAYS_AT_10_40_AM, callback);

const autoLogoutPeopleOnABreakJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.EVERYDAY_AT_11_59_PM, callback);

const holidaySyncJob = (callback: () => void) =>
  new CronJob(CRON_TIMES.DAILY_AT_2_00_AM, callback);

const production = process.env.NODE_ENV === "production";
const generalChannelID = production
  ? process.env.ANNOUNCEMENTS_CHANNEL_ID
  : process.env.TEST_CHANNEL_ID;

if (!generalChannelID)
  throw new Error("ANNOUNCEMENTS_CHANNEL_ID is not defined");

interface DailyAwardDefinition {
  title: string;
  emoji: string;
  userId: string | null;
  detail?: string;
}

function formatTimeForDiscord(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

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
  // Logout users on break every day at 11:59 PM
  // On Thursdays (end of BD work week), also generate the weekly attendance report
  // after logout to ensure accurate data
  autoLogoutPeopleOnABreakJob(async () => {
    // Capture day before async work — logout may span past midnight
    const isThursday = new Date().getDay() === 4;

    try {
      const allActiveDiscordIds = await getAllActiveEmployeeDiscordIds();
      await clearDailyAwardEmojisForUsers(allActiveDiscordIds);
    } catch (error) {
      console.error("Failed to clear daily award emojis:", error);
    }

    await autoLogoutUsersWhoAreStillLoggedIn(discordClient);

    if (isThursday) {
      try {
        await sendWeeklyAttendanceReportToAdmin(discordClient);
      } catch (err) {
        console.error("Failed to send weekly attendance report:", err);
      }
    }
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

    const awardWinners = await getDailyAttendanceAwardWinners();
    const uniqueWinnerUserIds = Array.from(
      new Set(
        [
          awardWinners.earlyBirdUserId,
          awardWinners.nightOwlUserId,
          awardWinners.timelyTurtleUserId,
          awardWinners.lazyBeaverUserId,
          awardWinners.projectHopperUserId,
        ].filter((userId): userId is string => Boolean(userId)),
      ),
    );

    const winnerDiscordIdObjects = uniqueWinnerUserIds.length
      ? await getDiscordIdsFromUserIds(uniqueWinnerUserIds)
      : [];
    const winnerDiscordIdMap = new Map<string, string>(
      winnerDiscordIdObjects.map((winner) => [winner.id, winner.discordId]),
    );

    const now = new Date();
    const todayAtTen = new Date(now);
    todayAtTen.setHours(10, 0, 0, 0);

    const dailyAwards: DailyAwardDefinition[] = [
      {
        title: "Early Bird",
        emoji: "🐦",
        userId: awardWinners.earlyBirdUserId,
        detail: "First check-in after 6:00 AM",
      },
      {
        title: "Night Owl",
        emoji: "🦉",
        userId: awardWinners.nightOwlUserId,
        detail: "Latest logout between 6:00 PM and 5:59 AM",
      },
      {
        title: "Timely Turtle",
        emoji: "🐢",
        userId: awardWinners.timelyTurtleUserId,
        detail: `Closest check-in to ${formatTimeForDiscord(todayAtTen)}`,
      },
      {
        title: "Lazy Beaver",
        emoji: "🦫",
        userId: awardWinners.lazyBeaverUserId,
        detail: "Latest check-in before scrum reminder",
      },
      {
        title: "Project Hopper",
        emoji: "🦘",
        userId: awardWinners.projectHopperUserId,
        detail: "Most project switches this morning",
      },
    ];

    const awardAnnouncementLines = dailyAwards
      .map((award) => {
        if (!award.userId) {
          return `${award.emoji} **${award.title}**: _No winner today_`;
        }

        const winnerDiscordId = winnerDiscordIdMap.get(award.userId);
        if (!winnerDiscordId) {
          return `${award.emoji} **${award.title}**: _No winner today_`;
        }

        const awardDetail = award.detail ? ` (${award.detail})` : "";
        return `${award.emoji} **${award.title}**: <@${winnerDiscordId}>${awardDetail}`;
      })
      .join("\n");

    for (const award of dailyAwards) {
      if (!award.userId) {
        continue;
      }
      const winnerDiscordId = winnerDiscordIdMap.get(award.userId);
      if (!winnerDiscordId) {
        continue;
      }

      await setDailyAwardEmoji(winnerDiscordId, award.emoji);
    }

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
        awardAnnouncementLines ? `\n\n**Today's Attendance Awards**\n${awardAnnouncementLines}` : ``
      }${
        usersOnLeave.length > 0 ? `\n\n${usersOnLeaveAnnouncement}` : ``
      }`,
    });
  }).start();
};
