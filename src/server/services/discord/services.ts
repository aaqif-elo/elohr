import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
} from "discord.js";
import { getNextHoliday, markUpcomingHolidaysAsAnnounced } from "../../db";

import { generateJWTFromUserDiscordId } from "../../api/routers/auth";

export const getHRLoginInteractionReplyPayload = async (
  interaction: ChatInputCommandInteraction,
  reason?: string
) => {
  try {
    const discordId = interaction.user.id;
    // new: actually generate the signed JWT
    const jwtResp = await generateJWTFromUserDiscordId(discordId);
    if (!jwtResp?.jwt) {
      await interaction.reply({
        content: `❌ Error generating login link. Please try again later.`,
        flags: "Ephemeral",
      });
      return;
    }
    const loginUrl = `${
      process.env.NODE_ENV === "production"
        ? process.env.FRONTEND_URL
        : `http://localhost:${process.env.PORT}`
    }/?token=${jwtResp.jwt}`;

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
