import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
} from "discord.js";
import {
  getDiscordIdsFromUserIds,
  getLoggedInUsers,
  getNextHoliday,
  isOnBreak,
  login,
  logout,
  markUpcomingHolidaysAsAnnounced,
} from "../../db";

import { generateJWTFromUserDiscordId } from "../../api/routers/auth";
import { setNameStatus } from "./utils";

import axios from "axios";
import { GoogleGenAI } from "@google/genai";

export const getLoginUrl = async (discordId: string) => {
  try {
    // new: actually generate the signed JWT
    const jwtResp = await generateJWTFromUserDiscordId(discordId);
    if (!jwtResp?.jwt) {
      return null;
    }
    const loginUrl = `${
      process.env.NODE_ENV === "production"
        ? process.env.FRONTEND_URL
        : `http://localhost:${process.env.PORT}`
    }/?token=${jwtResp.jwt}`;
    return loginUrl;
  } catch (error) {
    console.error("Error generating login link:", error);
    return null;
  }
};

export const getHRLoginInteractionReplyPayload = async (
  interaction: ChatInputCommandInteraction,
  reason?: string
) => {
  try {
    const discordId = interaction.user.id;

    const loginUrl = await getLoginUrl(discordId);
    if (!loginUrl) {
      await interaction.reply({
        content: `❌ Error generating login link. Please try again later.`,
        flags: "Ephemeral",
      });
      return;
    }
    const loginButton = new ButtonBuilder()
      .setLabel("ELO HR Login")
      .setStyle(ButtonStyle.Link)
      .setURL(loginUrl)
      .setEmoji("🌐");

    let message = `<@${discordId}> Please log in to the ELO HR Portal`;
    if (reason) message += ` to ${reason}`;
    message += ` by clicking below:`;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      loginButton
    );

    await interaction.reply({
      content: message,
      components: [row],
      flags: "Ephemeral",
    });
  } catch (error) {
    console.error("Error generating HR login link:", error);
    await interaction.reply({
      content: `❌ Error generating login link. Please try again later.`,
      flags: "Ephemeral",
    });
  }
};

const monthName = (date: Date): string => {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return monthNames[date.getMonth()];
};

const dayName = (date: Date): string => {
  const dayNames = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ];
  return dayNames[date.getDay()];
};

/**
 * Generates a formatted holiday announcement message
 * @param nextHoliday The holiday data object
 * @param currentDate Optional reference date to determine if holiday starts tomorrow (defaults to current date)
 * @returns Formatted announcement message
 */
export const getNextHolidayAnnouncementMsg = (
  nextHoliday: {
    startDate: string | Date;
    endDate: string | Date;
    holidays: string[];
  },
  currentDate: Date = new Date()
): string => {
  let message = `@everyone The office will be closed`;
  const TWENTY_FOUR_HOURS = 1000 * 60 * 60 * 24;
  const startDate = new Date(nextHoliday.startDate);
  const endDate = new Date(nextHoliday.endDate);
  const startsTomorrow =
    startDate.getTime() - currentDate.getTime() <= TWENTY_FOUR_HOURS;
  const singleHoliday =
    String(nextHoliday.endDate) === String(nextHoliday.startDate);

  if (startsTomorrow) {
    if (singleHoliday) {
      message += ` tomorrow`;
    } else {
      message += ` from tomorrow`;
    }
  } else {
    if (singleHoliday) {
      message += ` on`;
    } else {
      message += ` from`;
    }
  }

  message += ` ${dayName(startDate)} (${monthName(
    startDate
  )} ${startDate.getDate()})`;
  if (!singleHoliday) {
    message += ` to`;
    message += ` ${dayName(endDate)} (${monthName(
      endDate
    )} ${endDate.getDate()})`;
  }

  message += ` for`;
  if (nextHoliday.holidays.length === 1) {
    message += ` ${nextHoliday.holidays[0]}`;
  } else if (nextHoliday.holidays.length === 2) {
    message += ` ${nextHoliday.holidays[0]} and ${nextHoliday.holidays[1]}`;
  } else {
    for (let i = 0; i < nextHoliday.holidays.length; i++) {
      if (i === nextHoliday.holidays.length - 1) {
        message += ` and ${nextHoliday.holidays[i]}`;
      } else {
        message += ` ${nextHoliday.holidays[i]},`;
      }
    }
  }

  const officeReopenDate = new Date(endDate);
  officeReopenDate.setDate(officeReopenDate.getDate() + 1);
  message += `.\n\nThe office will reopen on ${dayName(
    officeReopenDate
  )} (${monthName(officeReopenDate)} ${officeReopenDate.getDate()}).`;

  message += `\n\nHappy Holidays 😃`;

  return message;
};

// For backward compatibility, create a function that fetches the holiday first
export const getUpcomingHolidayAnnouncementMsg = async (
  date: Date = new Date()
): Promise<string | undefined> => {
  const nextHoliday = await getNextHoliday(date);

  if (!nextHoliday) {
    return undefined;
  }

  return getNextHolidayAnnouncementMsg(nextHoliday, date);
};

/**
 * Sends a holiday announcement to a specified channel and marks it as announced
 * @param discordClient Discord client instance
 * @param nextHoliday The holiday data object
 * @param channelId The channel ID to send the announcement to
 * @returns Boolean indicating success of the operation
 */
export const announceHoliday = async (
  discordClient: Client<boolean>,
  nextHoliday:
    | {
        startDate: string | Date;
        endDate: string | Date;
        holidays: string[];
      }
    | null
    | undefined = null
): Promise<string | undefined> => {
  try {
    // Send the announcement
    const generalChannelID =
      process.env.NODE_ENV === "production"
        ? process.env.GENERAL_CHANNEL_ID
        : process.env.TEST_CHANNEL_ID;

    if (!generalChannelID) {
      return "❌ Channel ID not configured properly.";
    }

    const channel = await discordClient.channels.fetch(generalChannelID);

    if (!channel || channel.type !== ChannelType.GuildText) {
      return "❌ Channel not found or not a text channel.";
    }

    if (!nextHoliday) {
      nextHoliday = await getNextHoliday();
      if (!nextHoliday) {
        return "❌ No upcoming holidays found.";
      }
    }

    const content = getNextHolidayAnnouncementMsg(nextHoliday);

    await channel.send({ content });

    // Mark the holiday as announced - use authenticated API client
    const startDate = new Date(nextHoliday.startDate);

    const count = await markUpcomingHolidaysAsAnnounced(startDate);

    if (count === 0) {
      return "❌ Failed to mark holiday as announced.";
    }

    return;
  } catch (error) {
    console.error("Error announcing holiday:", error);
    return `❌ Failed to announce holiday. Error: ${error}`;
  }
};

export const autoLogoutUsersWhoAreStillLoggedIn = async (
  discordClient: Client<boolean>
) => {
  const attendanceChannelID =
    process.env.NODE_ENV === "production"
      ? process.env.ATTENDANCE_CHANNEL_ID
      : process.env.TEST_CHANNEL_ID;
  if (!attendanceChannelID) {
    return;
  }

  const attendanceChannel =
    discordClient.channels.cache.get(attendanceChannelID);

  if (!attendanceChannel || attendanceChannel.type !== ChannelType.GuildText) {
    return;
  }

  await attendanceChannel.send(`Auto-logout Initiated...`);
  // Get the list of users (by mongo ID) who are currently logged in
  const userIds = await getLoggedInUsers();
  const discordIds = await getDiscordIdsFromUserIds(userIds);
  if (!userIds.length) {
    return;
  }

  const logoutPromises = userIds.map(async (userId) => {
    // eslint-disable-next-line no-useless-catch
    try {
      const discordId = discordIds.find((d) => d.id === userId)?.discordId;

      if (!discordId) {
        return;
      }
      const wasOnBreak = await isOnBreak(userId);
      // Call logout using the determined logoutTimestamp (either break start time or now)
      const logoutReportAndTime = await logout(userId);

      if (!logoutReportAndTime) {
        return;
      }

      await setNameStatus(
        discordClient,
        process.env.STATUS_TAG_UNAVAILABLE || "O",
        discordId
      );
      const fetchedUser = await discordClient.users.fetch(discordId);
      if (logoutReportAndTime.report instanceof Buffer) {
        await fetchedUser.send({
          files: [logoutReportAndTime.report],
        });
      }
      return { discordId, userId, trackIsOnline: !wasOnBreak };
    } catch (err) {
      throw err;
    }
  });

  const logoutPayloads = await Promise.all(logoutPromises);

  setTimeout(async () => {
    const loginPromises = logoutPayloads.map(async (payload) => {
      if (!payload) {
        return;
      }
      const { discordId, userId, trackIsOnline } = payload;

      if (!process.env.DISCORD_SERVER_ID) {
        return;
      }
      // eslint-disable-next-line no-useless-catch
      try {
        if (!trackIsOnline) return;
        const member = (
          await (
            await discordClient.guilds.fetch(process.env.DISCORD_SERVER_ID)
          ).members.fetch()
        ).get(discordId);

        if (!member) {
          return;
        }

        const isOnline =
          member.voice.channel !== null &&
          member.voice.channelId !== member.guild.afkChannelId;

        if (isOnline) {
          await login(userId, member.voice.channel.name);
          await setNameStatus(
            discordClient,
            process.env.STATUS_TAG_AVAILABLE || "O",
            discordId
          );

          return `<@${discordId}> automatically logged in.`;
        }
      } catch (err) {
        throw err;
      }
    });

    const loginMessages = (await Promise.all(loginPromises)).filter(
      (msg) => msg !== undefined
    );

    if (loginMessages.length > 0) {
      let loginAnnouncement = `Auto-login Initiated for users who are online...\n\n`;
      loginMessages.forEach((msg) => (loginAnnouncement += `${msg}\n`));
      attendanceChannel.send(loginAnnouncement);
    }
  }, 90000); // 90 seconds
};

export const getWeatherReport = async () => {
  const weatherApiKey = process.env.OPEN_METEO_URL;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!weatherApiKey || !GEMINI_API_KEY) {
    console.error("Weather API key or Gemini API key is missing.");
    return;
  }
  try {
    const weather = await axios.get(weatherApiKey);
    const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
    const stringifiedWeather = JSON.stringify(weather.data);
    const prompt = `Can you generate a weather report from this? Include a fitting emoji and maybe a quirky quote for the day which relates to software/web development/agile/tech etc. Let's keep it short and succinct. 
    
    Follow this format:

    {City}, {Country}- {Date} {Emoji}

    {Weather report}

    Sunrise: {Time}
    Sunset: {Time}

    Quote (Italized) 🤖

    Ensure that it is formatted to be displayed in Discord via discord.js`;
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-lite",
      contents: [`${stringifiedWeather} ${prompt}`],
    });
    return response.text;
  } catch (error) {
    console.error("Error fetching weather data:", error);
    return;
  }
};
