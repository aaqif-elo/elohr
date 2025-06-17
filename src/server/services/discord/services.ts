import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  User,
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
  reviewLeaveRequest,
} from "../../db";

import { generateJWTFromUserDiscordId } from "../../api/routers/auth";
import { setNameStatus } from "./utils";

import axios from "axios";
import { GoogleGenAI } from "@google/genai";
import { Leave } from "@prisma/client";

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

  let prefix = "";
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

      await setNameStatus(
        discordClient,
        process.env.STATUS_TAG_UNAVAILABLE || "O",
        discordId
      );

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
  const openMeteoApiUrl = process.env.OPEN_METEO_URL;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!openMeteoApiUrl || !GEMINI_API_KEY) {
    console.error("Weather API key or Gemini API key is missing.");
    return;
  }

  const maxRetries = 3;
  const timeoutMs = 10000; // 10 seconds

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempting weather API call (${attempt}/${maxRetries})...`);
      
      const weather = await axios.get(openMeteoApiUrl, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'YourApp/1.0'
        }
      });

      const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });
      const stringifiedWeather = JSON.stringify(weather.data);
      const prompt = `Can you generate a weather report from this? Include a fitting emoji and maybe a quirky quote for the day which relates to software/web development/agile/tech etc. Let's keep it short and succinct. 
      
      Follow this format:

      {City}, {Country}- {Date} {Emoji}

      {Weather report}

      Sunrise: {Time}
      Sunset: {Time}

      Quote (Italized) 🤖

      Ensure that it is formatted in markdown to be displayed in Discord via discord.js. Don't include anything else except what's in the format.`;

      const response = await ai.models.generateContent({
        model: "gemini-2.0-flash",
        contents: [`${stringifiedWeather} ${prompt}`],
      });
      return response.text;
    } catch (error) {
      console.error(`Weather API attempt ${attempt} failed:`, error instanceof Error ? error.message : String(error));
      
      if (attempt === maxRetries) {
        console.error("All weather API attempts failed:", error);
        return "⚠️ Weather service temporarily unavailable. Please try again later.";
      }
      
      // Wait before retrying (exponential backoff)
      const delay = Math.pow(2, attempt) * 1000;
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
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
          ephemeral: true,
        });
        return;
      }

      const adminDiscordId = interaction.user.id;
      const adminId = (await getUserByDiscordId(adminDiscordId))?.id;

      if (!adminId) {
        await interaction.reply({
          content: "Your Discord ID is not linked to any user.",
          ephemeral: true,
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

    collector.on("end", async (collected) => {
      if (collected.size === 0) {
        // No interaction occurred, update the message
        try {
          await message.edit({
            content: `**Leave Request EXPIRED**\n<@${discordId}>'s leave request ${datesDescription} has expired without action.${reason}`,
            components: [],
          });
        } catch (error) {
          console.error("Failed to update expired message:", error);
        }
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

export const sendLogoutReport = async (
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
