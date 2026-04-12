import type {
  ChatInputCommandInteraction,
  Client,
  TextChannel,
  User} from "discord.js";
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType
} from "discord.js";
import {
  generateAttendanceImageReport,
  getDiscordIdsFromUserIds,
  getLeaveById,
  getLoggedInUsers,
  getNextHoliday,
  getUserByDiscordId,
  isOnBreak,
  login,
  logout,
  markUpcomingHolidaysAsAnnounced,
  ONE_DAY_IN_MS,
  getAllEmployeesWithAttendance,
  getLeavesInDateRange,
  getWeekDateRange,
  countWorkingDays,
  getHolidaysForDateRange,
  reviewLeaveRequest,
} from "../../db";

import { generateJWTFromUserDiscordId } from "../../api/routers/auth";
import { setNameStatus } from "./utils";

import { GoogleGenAI } from "@google/genai";
import type { Leave } from "@prisma/client";

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
const getNextHolidayAnnouncementMsg = (
  nextHoliday: {
    startDate: string | Date;
    endDate: string | Date;
    holidays: string[];
  },
  currentDate: Date = new Date()
): string => {
  let message = `@everyone The office will be closed`;

  const startDateObj = new Date(nextHoliday.startDate);
  const endDateObj = new Date(nextHoliday.endDate);

  const todayNormalized = new Date(currentDate);
  todayNormalized.setHours(0, 0, 0, 0);

  const tomorrowNormalized = new Date(todayNormalized);
  tomorrowNormalized.setDate(todayNormalized.getDate() + 1);

  const holidayStartDateNormalized = new Date(startDateObj);
  holidayStartDateNormalized.setHours(0, 0, 0, 0);

  const startsTomorrow =
    holidayStartDateNormalized.getTime() === tomorrowNormalized.getTime();

  // Check if the effective closure period is a single calendar day
  const isEffectivelySingleDayClosure =
    startDateObj.toDateString() === endDateObj.toDateString();

  const startDayOfWeek = startDateObj.getDay(); // 0 for Sunday, 4 for Thursday
  const numHolidaysInChain = nextHoliday.holidays.length;

  let useFromLogic: boolean;

  // Determine if "from" logic (e.g., "from Date1 to Date2") should be used
  if (startDayOfWeek === 0 || startDayOfWeek === 4) {
    // Holiday starts on a Sunday or Thursday
    // Use "from" if there are multiple holidays in the chain, otherwise use "on"
    useFromLogic = numHolidaysInChain > 1;
  } else {
    // Holiday starts on any other day
    // Use "from" if the closure period spans multiple days, otherwise use "on"
    useFromLogic = !isEffectivelySingleDayClosure;
  }

  let prefix: string;
  if (startsTomorrow) {
    if (useFromLogic) {
      prefix = " from tomorrow";
    } else {
      prefix = " tomorrow"; // Implies "on tomorrow"
    }
  } else {
    if (useFromLogic) {
      prefix = " from";
    } else {
      prefix = " on";
    }
  }
  message += prefix;

  message += ` ${dayName(startDateObj)} (${monthName(
    startDateObj
  )} ${startDateObj.getDate()})`;

  // Add "to endDate" only if the closure period is not a single day
  // This is implicitly handled if useFromLogic was true,
  // but explicitly checking isEffectivelySingleDayClosure is clearer for this part.
  if (!isEffectivelySingleDayClosure) {
    message += ` to`;
    message += ` ${dayName(endDateObj)} (${monthName(
      endDateObj
    )} ${endDateObj.getDate()})`;
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

  const officeReopenDate = new Date(endDateObj);
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
    return;
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
        ? process.env.ANNOUNCEMENTS_CHANNEL_ID
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

  // Get the list of users (by mongo ID) who are currently logged in
  const userIds = await getLoggedInUsers();
  const discordIds = await getDiscordIdsFromUserIds(userIds);
  if (!userIds.length) {
    return;
  }
  await attendanceChannel.send(`Auto-logout Initiated...`);
  const today = new Date(); // Capture current date
  const logoutPromises = userIds.map(async (userId) => {
    try {
      const discordId = discordIds.find((d) => d.id === userId)?.discordId;

      if (!discordId) {
        return;
      }
      const wasOnBreak = await isOnBreak(userId);
      // Call logout using the determined logoutTimestamp
      const logoutInfo = await logout(userId);

      if (!logoutInfo) {
        return;
      }

      await setNameStatus(process.env.STATUS_TAG_UNAVAILABLE || "O", discordId);

      const fetchedUser = await discordClient.users.fetch(discordId);

      // Send text report immediately with date parameter for the report

      const imageReportPromise = generateAttendanceImageReport(userId, today);
      await sendLogoutReport(
        fetchedUser,
        logoutInfo.textReport,
        imageReportPromise
      );

      return { discordId, userId, trackIsOnline: !wasOnBreak };
    } catch (err) {
      console.error("Error during auto-logout:", err);
      return null;
    }
  });

  const logoutPayloads = await Promise.all(logoutPromises);

  // Set up auto-login after 90 seconds (at 12:01 AM)
  setTimeout(async () => {
    if (!process.env.DISCORD_SERVER_ID) return;

    const trackablePayloads = logoutPayloads.filter(
      (p): p is NonNullable<typeof p> => !!p?.trackIsOnline
    );
    if (!trackablePayloads.length) return;

    // Fetch guild members once instead of per-user
    const guild = await discordClient.guilds.fetch(process.env.DISCORD_SERVER_ID);
    const members = await guild.members.fetch();

    const loginPromises = trackablePayloads.map(async ({ discordId, userId }) => {
      const member = members.get(discordId);
      if (!member) return;

      const isOnline =
        member.voice.channel !== null &&
        member.voice.channelId !== member.guild.afkChannelId;
      if (!isOnline) return;

      await login(userId, member.voice.channel.name);
      await setNameStatus(process.env.STATUS_TAG_AVAILABLE || "O", discordId);

      return `<@${discordId}> automatically logged in.`;
    });

    const loginMessages = (await Promise.all(loginPromises)).filter(
      (msg): msg is string => !!msg
    );

    if (loginMessages.length > 0) {
      attendanceChannel.send(
        `Auto-login Initiated for users who are online...\n\n${loginMessages.join("\n")}`
      );
    }
  }, 90000); // 90 seconds
};

export const getWeatherReport = async (): Promise<string | undefined> => {
  const openMeteoApiUrl = process.env.OPEN_METEO_URL;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!openMeteoApiUrl || !GEMINI_API_KEY) {
    console.error("Weather API key or Gemini API key is missing.");
    return;
  }

  const maxRetries = 10;
  const timeoutMs = 10000; // 10 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting weather API call (${attempt}/${maxRetries})...`);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const weatherResponse = await fetch(openMeteoApiUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "EloHR/1.0",
        },
      });
      clearTimeout(timeoutId);

      if (!weatherResponse.ok) {
        throw new Error(`Weather API returned ${weatherResponse.status}`);
      }

      const weatherData = await weatherResponse.json();

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const stringifiedWeather = JSON.stringify(weatherData);
      const prompt = `Can you generate a weather report from this? Let's keep it short and succinct. 
      
      Follow this format:

      {City}, {Country}- {Date} {Emoji}

      {Weather report}

      Sunrise: {Time}
      Sunset: {Time}

      Ensure that it is formatted in markdown to be displayed in Discord via discord.js. Don't include anything else except what's in the format.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [`${stringifiedWeather} ${prompt}`],
        config: {
          temperature: 1.5,
        },
      });
      return response.text;
    } catch (error) {
      console.error(
        `Weather API attempt ${attempt} failed:`,
        error instanceof Error ? error.message : String(error)
      );

      if (attempt === maxRetries) {
        console.error("All weather API attempts failed:", error);
        return;
      }

      // Add longer delays and jitter for better retry behavior
      const baseDelay = Math.pow(2, attempt) * 1000;
      const jitter = Math.random() * 1000;
      const delay = baseDelay + jitter;

      console.error(`Retrying in ${Math.round(delay)}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  return;
};

// Update LEAVE_BUTTON_IDS enum
enum LEAVE_BUTTON_IDS {
  APPROVE = "approve",
  REJECT = "reject",
}

/**
 * Sends a leave request notification to the admin channel
 *
 * @param leave The created leave request
 * @param discordId The Discord ID of the requesting user
 * @returns Object with success status and message ID if successful
 */
export const sendLeaveRequestNotification = async (
  discordClient: Client<boolean>,
  leave: Leave,
  discordId: string
): Promise<{ success: boolean; messageId?: string }> => {
  try {
    const adminChannelID = process.env.ADMIN_CHANNEL_ID;

    if (!adminChannelID) {
      console.error("ADMIN_CHANNEL_ID not defined");
      return { success: false };
    }

    const channel = await discordClient.channels.fetch(adminChannelID);

    if (!channel || channel.type !== ChannelType.GuildText) {
      console.error("Admin channel not found or not a text channel");
      return { success: false };
    }

    // Format dates for display
    const formattedDates = leave.dates.map((date: Date) => {
      return date.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    });

    // Create description based on number of dates
    let datesDescription = "";
    if (formattedDates.length === 1) {
      datesDescription = `on ${formattedDates[0]}`;
    } else {
      datesDescription = `from ${formattedDates[0]} to ${
        formattedDates[formattedDates.length - 1]
      } (${formattedDates.length} days)`;
    }

    console.log("leave", leave);
    console.log("approve id", `${LEAVE_BUTTON_IDS.APPROVE}-${leave.id}`);
    console.log("reject id", `${LEAVE_BUTTON_IDS.REJECT}-${leave.id}`);

    // Create buttons
    const approveButton = new ButtonBuilder()
      .setLabel("Approve")
      .setStyle(ButtonStyle.Success)
      .setCustomId(`${LEAVE_BUTTON_IDS.APPROVE}-${leave.id}`)
      .setEmoji("✅");

    const rejectButton = new ButtonBuilder()
      .setLabel("Reject")
      .setStyle(ButtonStyle.Danger)
      .setCustomId(`${LEAVE_BUTTON_IDS.REJECT}-${leave.id}`)
      .setEmoji("❌");

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      approveButton,
      rejectButton
    );

    // Create the message content
    const reason = leave.reason ? `\n\n**Reason**: ${leave.reason}` : "";
    const expiryTime = new Date(Date.now() + ONE_DAY_IN_MS);
    const formattedExpiryTime = expiryTime.toLocaleString("en-US");

    const content = `**Leave Request**\n<@${discordId}> has requested leave ${datesDescription}.${reason}\n\n*This request will expire at ${formattedExpiryTime}.*`;

    // Send the message
    const message = await channel.send({
      content,
      components: [row],
    });

    // Set up collector for button interactions
    const collector = message.createMessageComponentCollector({
      time: ONE_DAY_IN_MS,
    });

    collector.on("collect", async (interaction) => {
      console.log("interaction", interaction.customId);
      const [action, leaveId] = interaction.customId.split("-");
      console.log("action", action);
      console.log("leaveId", leaveId);
      // Verify the leave exists and is still pending
      const updatedLeave = await getLeaveById(leaveId);
      console.log("updatedLeave", updatedLeave);
      if (!updatedLeave || updatedLeave.reviewed) {
        await interaction.reply({
          content:
            "This leave request has already been processed or doesn't exist.",
          flags: "Ephemeral",
        });
        return;
      }

      const adminDiscordId = interaction.user.id;
      const adminId = (await getUserByDiscordId(adminDiscordId))?.id;

      if (!adminId) {
        await interaction.reply({
          content: "Your Discord ID is not linked to any user.",
          flags: "Ephemeral",
        });
        return;
      }

      if (action === LEAVE_BUTTON_IDS.APPROVE) {
        // Approve the leave
        await reviewLeaveRequest(leaveId, true, adminId);

        // Send confirmation to attendance channel
        const attendanceChannelID = process.env.ATTENDANCE_CHANNEL_ID;
        if (attendanceChannelID) {
          const attendanceChannel = await discordClient.channels.fetch(
            attendanceChannelID
          );
          if (
            attendanceChannel &&
            attendanceChannel.type === ChannelType.GuildText
          ) {
            await attendanceChannel.send({
              content: `@everyone <@${discordId}> will be on leave ${datesDescription}.`,
            });
          }
        }

        // Update the original message
        await interaction.update({
          content: `**Leave Request APPROVED**\n<@${discordId}>'s leave request ${datesDescription} has been approved by <@${adminDiscordId}>.${reason}`,
          components: [],
        });
      } else if (action === LEAVE_BUTTON_IDS.REJECT) {
        // Reject the leave
        await reviewLeaveRequest(leaveId, false, adminId);

        // Send rejection message to user
        try {
          const user = await discordClient.users.fetch(discordId);
          await user.send({
            content: `Your leave request ${datesDescription} has been denied.`,
          });
        } catch (error) {
          console.error("Failed to send DM to user:", error);
        }

        // Update the original message
        await interaction.update({
          content: `**Leave Request REJECTED**\n<@${discordId}>'s leave request ${datesDescription} has been rejected by <@${adminDiscordId}>.${reason}`,
          components: [],
        });
      }
    });

    collector.on("end", async (_collected, endReason) => {
      if (endReason !== "time") {
        return;
      }

      try {
        const latestMessage = await channel.messages.fetch(message.id);

        if (latestMessage.components.length === 0) {
          return;
        }

        const cannotReviewMessage =
          "\n\n⚠️ This request can no longer be approved or rejected.";

        await latestMessage.edit({
          content: `${latestMessage.content}${cannotReviewMessage}`,
          components: [],
        });
      } catch (error) {
        console.error("Failed to update expired leave request message:", error);
      }
    });

    return { success: true, messageId: message.id };
  } catch (error) {
    console.error("Error sending leave request notification:", error);
    return { success: false };
  }
};

/**
 * Delete a Discord message from the admin channel
 *
 * @param discordClient Discord client instance
 * @param messageId The message ID to delete
 * @returns Boolean indicating success of operation
 */
export const deleteLeaveRequestMessage = async (
  discordClient: Client<boolean>,
  messageId: string
): Promise<boolean> => {
  try {
    const adminChannelID = process.env.ADMIN_CHANNEL_ID;

    if (!adminChannelID) {
      console.error("ADMIN_CHANNEL_ID not defined");
      return false;
    }

    const channel = await discordClient.channels.fetch(adminChannelID);

    if (!channel || channel.type !== ChannelType.GuildText) {
      console.error("Admin channel not found or not a text channel");
      return false;
    }

    try {
      const message = await channel.messages.fetch(messageId);
      if (message) {
        await message.delete();
        return true;
      }
    } catch (error) {
      // Message might not exist anymore, which is fine
      console.log("Message not found, might be already deleted:", error);
    }

    return false;
  } catch (error) {
    console.error("Error deleting leave request message:", error);
    return false;
  }
};

const sendLogoutReport = async (
  user: User,
  textReportOrBuffer: string | Buffer<ArrayBuffer>,
  imageReportPromise?: Promise<Buffer | null>
): Promise<void> => {
  const loginUrl = await getLoginUrl(user.id);

  if (!loginUrl) {
    console.error("Error generating login link for user:", user.id);
    return;
  }

  const hrLoginButton = new ButtonBuilder()
    .setLabel("ELO HR Login")
    .setStyle(ButtonStyle.Link)
    .setURL(loginUrl)
    .setEmoji("🌐");

  try {
    // If textReportOrBuffer is a Buffer, it's the old-style direct report
    if (textReportOrBuffer instanceof Buffer) {
      await user.send({
        files: [textReportOrBuffer],
        content: `Please log in to the Portal to view more details.`,
        components: [
          new ActionRowBuilder<ButtonBuilder>().addComponents(hrLoginButton),
        ],
      });
      return;
    }

    // Otherwise it's a text report with a pending image
    const sentMessage = await user.send({
      content: `${textReportOrBuffer}\n\nPlease log in to the Portal to view more details.\n\n*Generating detailed report...*`,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(hrLoginButton),
      ],
    });

    // Wait for image report and update the message when it's ready
    if (imageReportPromise) {
      imageReportPromise
        .then(async (imageBuffer) => {
          if (imageBuffer) {
            await sentMessage.edit({
              content: `${textReportOrBuffer}\n\nPlease log in to the Portal to view more details.`,
              files: [imageBuffer],
              components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                  hrLoginButton
                ),
              ],
            });
          } else {
            // No image buffer returned, remove the "generating" message
            await sentMessage.edit({
              content: `${textReportOrBuffer}\n\nPlease log in to the Portal to view more details.`,
              components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                  hrLoginButton
                ),
              ],
            });
          }
        })
        .catch(async (error) => {
          console.error("Failed to generate image report:", error);
          // Remove the "generating" message when there's an error
          await sentMessage.edit({
            content: `${textReportOrBuffer}\n\nPlease log in to the Portal to view more details.`,
            components: [
              new ActionRowBuilder<ButtonBuilder>().addComponents(
                hrLoginButton
              ),
            ],
          });
        });
    }
  } catch (error) {
    console.error("Failed to send logout report:", error);
  }
};

// Outlier detection thresholds (office hours: 10 AM – 6 PM)
const LATE_THRESHOLD_MINUTES = 10 * 60 + 30; // 10:30 AM in minutes
const LATE_MIN_DAYS = 3; // must be late on at least this many days
const HOURS_DEVIATION_THRESHOLD = 0.2; // 20% above/below team median
const SHORT_DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Build and send a markdown-formatted weekly attendance report to the admin channel
export async function sendWeeklyAttendanceReportToAdmin(
  discordClient: Client<boolean>,
  referenceDate: Date = new Date()
) {
  const adminChannelID = process.env.ADMIN_CHANNEL_ID;
  if (!adminChannelID) {
    console.error("ADMIN_CHANNEL_ID not defined");
    return;
  }

  const channel = await discordClient.channels.fetch(adminChannelID);
  if (!channel || channel.type !== ChannelType.GuildText) {
    console.error("Admin channel not found or not a text channel");
    return;
  }

  const { start: weekStart, end: weekEnd } = getWeekDateRange(referenceDate);

  // Fetch holidays for the week to determine working days
  const holidays = await getHolidaysForDateRange(weekStart, weekEnd);
  const holidayDates = holidays.map(
    (h) => h.overridenDate ?? h.originalDate
  );
  const workingDays = countWorkingDays(weekStart, weekEnd, holidayDates);

  // Collect per-day attendance for every employee across the work week (Sun–Thu)
  const dayDates: Date[] = [];
  const cursor = new Date(weekStart);
  while (cursor <= weekEnd) {
    const dow = cursor.getDay();
    // Only include Sun(0)–Thu(4), skip Fri/Sat
    if (dow >= 0 && dow <= 4) {
      dayDates.push(new Date(cursor));
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Parallel: fetch each day's employees+attendance and the week's leaves
  const [dailySnapshots, leaves] = await Promise.all([
    Promise.all(dayDates.map((d) => getAllEmployeesWithAttendance(d))),
    getLeavesInDateRange(weekStart, weekEnd),
  ]);

  // Build a holiday set for quick lookup
  const holidayIsoSet = new Set(
    holidayDates.map((d) => new Date(d).toISOString().split("T")[0])
  );

  // Determine actual working day dates (exclude holidays)
  const workingDayDates = dayDates.filter(
    (d) => !holidayIsoSet.has(d.toISOString().split("T")[0])
  );

  // Build per-employee weekly data from daily snapshots
  type EmployeeDayData = {
    loginMinutes: number;
    totalHoursMs: number;
    projects: Map<string, number>;
  };

  type EmployeeWeekData = {
    name: string;
    days: Map<string, EmployeeDayData>; // ISO date string -> day data
    leaveDays: Set<string>; // ISO date strings on leave
  };

  const employeeMap = new Map<string, EmployeeWeekData>();

  // Index leaves by userId -> set of ISO date strings
  const leavesByUser = new Map<string, { dates: Set<string>; reason?: string }>();
  for (const leave of leaves) {
    const existing = leavesByUser.get(leave.userId);
    const leaveDateStrings = leave.dates
      .map((d) => new Date(d).toISOString().split("T")[0])
      .filter(
        (iso) =>
          iso >= weekStart.toISOString().split("T")[0] &&
          iso <= weekEnd.toISOString().split("T")[0]
      );

    if (existing) {
      for (const ds of leaveDateStrings) existing.dates.add(ds);
    } else {
      leavesByUser.set(leave.userId, {
        dates: new Set(leaveDateStrings),
        reason: leave.reason ?? undefined,
      });
    }
  }

  // Process daily snapshots
  for (let dayIdx = 0; dayIdx < dayDates.length; dayIdx++) {
    const dayIso = dayDates[dayIdx].toISOString().split("T")[0];
    const isHolidayDay = holidayIsoSet.has(dayIso);
    const employees = dailySnapshots[dayIdx] as { id: string; name: string; attendance?: { login: string; workSegments: { start: string; end: string; project: string }[] } }[];

    for (const emp of employees) {
      if (!employeeMap.has(emp.id)) {
        employeeMap.set(emp.id, {
          name: emp.name ?? "Unknown",
          days: new Map(),
          leaveDays: new Set(),
        });
      }
      const empData = employeeMap.get(emp.id);
      if (!empData) continue;

      // Skip holidays — don't count as absent
      if (isHolidayDay) continue;

      // Mark leave days
      const userLeave = leavesByUser.get(emp.id);
      if (userLeave?.dates.has(dayIso)) {
        empData.leaveDays.add(dayIso);
        continue;
      }

      // Process attendance if present
      if (emp.attendance) {
        const login = new Date(emp.attendance.login);
        const loginMinutes = login.getHours() * 60 + login.getMinutes();
        let totalMs = 0;
        const projMs = new Map<string, number>();
        const segments = Array.isArray(emp.attendance.workSegments)
          ? emp.attendance.workSegments
          : [];

        for (const ws of segments) {
          const s = ws.start ? new Date(ws.start) : null;
          const e = ws.end ? new Date(ws.end) : null;
          if (!s || !e || isNaN(s.getTime()) || isNaN(e.getTime())) continue;
          const diff = e.getTime() - s.getTime();
          if (diff <= 0) continue;
          totalMs += diff;
          const proj = ws.project || "(Unspecified)";
          projMs.set(proj, (projMs.get(proj) || 0) + diff);
        }

        empData.days.set(dayIso, {
          loginMinutes,
          totalHoursMs: totalMs,
          projects: projMs,
        });
      }
    }
  }

  // Helpers
  const toHours = (ms: number) => ms / (1000 * 60 * 60);
  const fmtHours = (hrs: number) => `${hrs.toFixed(1)}h`;
  const minutesToTimeStr = (mins: number) => {
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `${h12}:${m.toString().padStart(2, "0")} ${period}`;
  };
  const median = (nums: number[]) => {
    if (!nums.length) return 0;
    const s = [...nums].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  };
  const fmtDateShort = (isoDate: string) => {
    const d = new Date(isoDate);
    return SHORT_DAY_NAMES[d.getDay()];
  };

  // Aggregate per-employee stats
  type EmployeeStats = {
    name: string;
    daysPresent: number;
    daysAbsent: number;
    daysOnLeave: number;
    totalHours: number;
    avgLoginMinutes: number;
    lateDays: number;
    absentDayNames: string[];
    leaveDayNames: string[];
  };

  const employeeStats: EmployeeStats[] = [];
  const allWeeklyHours: number[] = [];
  const allLoginMinutes: number[] = [];
  const projectTotals = new Map<string, { hours: number; employeeIds: Set<string> }>();
  const teamSize = employeeMap.size;
  let totalPersonDaysPresent = 0;

  for (const [userId, empData] of employeeMap) {
    const daysPresent = empData.days.size;
    const daysOnLeave = empData.leaveDays.size;
    const daysAbsent = workingDays - daysPresent - daysOnLeave;
    const totalHoursMs = [...empData.days.values()].reduce(
      (sum, d) => sum + d.totalHoursMs,
      0
    );
    const totalHours = toHours(totalHoursMs);
    const loginMinutesList = [...empData.days.values()].map((d) => d.loginMinutes);
    const avgLoginMinutes = loginMinutesList.length
      ? loginMinutesList.reduce((a, b) => a + b, 0) / loginMinutesList.length
      : 0;
    const lateDays = loginMinutesList.filter(
      (m) => m > LATE_THRESHOLD_MINUTES
    ).length;

    // Determine which working days were absent (no attendance, no leave, not holiday)
    const absentDayNames: string[] = [];
    const leaveDayNames: string[] = [];
    for (const wd of workingDayDates) {
      const iso = wd.toISOString().split("T")[0];
      if (empData.leaveDays.has(iso)) {
        leaveDayNames.push(fmtDateShort(iso));
      } else if (!empData.days.has(iso)) {
        absentDayNames.push(fmtDateShort(iso));
      }
    }

    employeeStats.push({
      name: empData.name,
      daysPresent,
      daysAbsent: Math.max(0, daysAbsent),
      daysOnLeave,
      totalHours,
      avgLoginMinutes,
      lateDays,
      absentDayNames,
      leaveDayNames,
    });

    if (daysPresent > 0) {
      allWeeklyHours.push(totalHours);
      allLoginMinutes.push(...loginMinutesList);
    }
    totalPersonDaysPresent += daysPresent;

    // Aggregate project totals
    for (const dayData of empData.days.values()) {
      for (const [proj, ms] of dayData.projects) {
        const hrs = toHours(ms);
        const rec = projectTotals.get(proj) || {
          hours: 0,
          employeeIds: new Set<string>(),
        };
        rec.hours += hrs;
        rec.employeeIds.add(userId);
        projectTotals.set(proj, rec);
      }
    }
  }

  const totalPersonDays = teamSize * workingDays;
  const attendanceRate =
    totalPersonDays > 0
      ? ((totalPersonDaysPresent / totalPersonDays) * 100).toFixed(0)
      : "0";
  const medianWeeklyHours = median(allWeeklyHours);
  const avgDailyHours =
    allWeeklyHours.length > 0
      ? allWeeklyHours.reduce((a, b) => a + b, 0) /
        allWeeklyHours.length /
        workingDays
      : 0;
  const medianLoginMinutes = median(allLoginMinutes);

  // Classify outliers
  const absent = employeeStats
    .filter((e) => e.daysAbsent > 0)
    .sort((a, b) => b.daysAbsent - a.daysAbsent);
  const consistentlyLate = employeeStats
    .filter(
      (e) =>
        e.lateDays >= LATE_MIN_DAYS && e.avgLoginMinutes > LATE_THRESHOLD_MINUTES
    )
    .sort((a, b) => b.avgLoginMinutes - a.avgLoginMinutes);
  const aboveAvgHours =
    medianWeeklyHours > 0
      ? employeeStats
          .filter(
            (e) =>
              e.daysPresent > 0 &&
              e.totalHours > medianWeeklyHours * (1 + HOURS_DEVIATION_THRESHOLD)
          )
          .sort((a, b) => b.totalHours - a.totalHours)
      : [];
  const belowAvgHours =
    medianWeeklyHours > 0
      ? employeeStats
          .filter(
            (e) =>
              e.daysPresent > 0 &&
              e.totalHours < medianWeeklyHours * (1 - HOURS_DEVIATION_THRESHOLD)
          )
          .sort((a, b) => a.totalHours - b.totalHours)
      : [];
  const perfectAttendance = employeeStats
    .filter(
      (e) =>
        e.daysPresent === workingDays &&
        e.daysAbsent === 0 &&
        e.avgLoginMinutes <= LATE_THRESHOLD_MINUTES
    )
    .sort((a, b) => a.name.localeCompare(b.name));

  // Build leave summary
  type LeaveSummaryItem = { name: string; dayNames: string[]; reason?: string };
  const leaveSummary: LeaveSummaryItem[] = [];
  for (const emp of employeeStats) {
    if (emp.daysOnLeave > 0) {
      const userLeave = [...leavesByUser.entries()].find(([uid]) => {
        const empEntry = [...employeeMap.entries()].find(
          ([id]) => id === uid
        );
        return empEntry && empEntry[1].name === emp.name;
      });
      leaveSummary.push({
        name: emp.name,
        dayNames: emp.leaveDayNames,
        reason: userLeave?.[1].reason,
      });
    }
  }
  leaveSummary.sort((a, b) => a.name.localeCompare(b.name));

  // Sort projects by hours
  const sortedProjects = [...projectTotals.entries()]
    .map(([name, rec]) => ({
      name,
      hours: rec.hours,
      employees: rec.employeeIds.size,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 5);

  // Format the report
  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  const header = `**Weekly Attendance Report — ${fmtDate(weekStart)} to ${fmtDate(weekEnd)}**`;

  const lines: string[] = [header, ""];

  // Overview
  const holidayCount = dayDates.length - workingDays;
  lines.push("### Overview");
  lines.push(
    `- Team Size: ${teamSize} | Working Days: ${workingDays}${holidayCount > 0 ? ` | Holidays: ${holidayCount}` : ""}`
  );
  lines.push(
    `- Attendance Rate: ${attendanceRate}% (${totalPersonDaysPresent}/${totalPersonDays} person-days)`
  );
  lines.push(
    `- Avg Daily Hours: ${fmtHours(avgDailyHours)} | Median Login Time: ${minutesToTimeStr(medianLoginMinutes)}`
  );
  lines.push("");

  // Highlights
  const hasHighlights =
    absent.length > 0 ||
    consistentlyLate.length > 0 ||
    aboveAvgHours.length > 0 ||
    belowAvgHours.length > 0 ||
    perfectAttendance.length > 0;

  if (hasHighlights) {
    lines.push("### Highlights");

    if (absent.length > 0) {
      lines.push("🔴 **Absences** (no login, no leave)");
      for (const e of absent) {
        lines.push(
          `- ${e.name}: ${e.absentDayNames.join(", ")} (${e.daysAbsent} day${e.daysAbsent > 1 ? "s" : ""})`
        );
      }
      lines.push("");
    }

    if (consistentlyLate.length > 0) {
      lines.push("⏰ **Consistently Late** (avg login after 10:30 AM on 3+ days)");
      for (const e of consistentlyLate) {
        lines.push(
          `- ${e.name}: avg login ${minutesToTimeStr(e.avgLoginMinutes)} (${e.lateDays} day${e.lateDays > 1 ? "s" : ""} late)`
        );
      }
      lines.push("");
    }

    if (aboveAvgHours.length > 0) {
      lines.push("📈 **Above Average Hours** (>20% above team median)");
      for (const e of aboveAvgHours) {
        const pct = (
          ((e.totalHours - medianWeeklyHours) / medianWeeklyHours) *
          100
        ).toFixed(0);
        lines.push(
          `- ${e.name}: ${fmtHours(e.totalHours)} total — ${pct}% above median`
        );
      }
      lines.push("");
    }

    if (belowAvgHours.length > 0) {
      lines.push("📉 **Below Average Hours** (>20% below team median)");
      for (const e of belowAvgHours) {
        const pct = (
          ((medianWeeklyHours - e.totalHours) / medianWeeklyHours) *
          100
        ).toFixed(0);
        lines.push(
          `- ${e.name}: ${fmtHours(e.totalHours)} total — ${pct}% below median`
        );
      }
      lines.push("");
    }

    if (perfectAttendance.length > 0) {
      lines.push("⭐ **Perfect Attendance** (all days, on time)");
      lines.push(`- ${perfectAttendance.map((e) => e.name).join(", ")}`);
      lines.push("");
    }
  }

  // Projects
  if (sortedProjects.length > 0) {
    lines.push("### Projects");
    for (const p of sortedProjects) {
      lines.push(
        `- ${p.name}: ${fmtHours(p.hours)} (${p.employees} employee${p.employees > 1 ? "s" : ""})`
      );
    }
    lines.push("");
  }

  // Leave
  if (leaveSummary.length > 0) {
    lines.push("### Leave");
    for (const l of leaveSummary) {
      const reason = l.reason ? ` (${l.reason})` : "";
      lines.push(`- ${l.name}: ${l.dayNames.join(", ")}${reason}`);
    }
    lines.push("");
  }

  const content = lines.join("\n");
  await (channel as TextChannel).send({ content });
}
