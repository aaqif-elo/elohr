import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  TextChannel,
} from "discord.js";
import {
  authCommandBody,
  getNextHolidayAnnouncementCommandBody,
  requestLeaveCommandBody,
} from "./commands";
import { meetingCommandBody } from "./commands";

import { interactionHandler } from "./interaction-handlers";
import {
  getMeetingById,
  setMeetingRequestAcceptance,
  cancelMeeting,
  getUserByDiscordId,
  getWeekdayAvailabilityHeatmap,
  getGroupWeekdayAvailabilityWindows,
} from "../../db";
import { handleVoiceStateChange } from "./voice-channel-hook.service";
import { setNameStatus } from "./utils";
import { startCronJobs } from "./cron-jobs";
declare global {
  var _discordClientGlobal: Client | undefined;
}

// Environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_SERVER_ID = process.env.DISCORD_SERVER_ID;
const BOT_ID = process.env.BOT_ID;
const production = process.env.NODE_ENV === "production";
const ATTENDANCE_CHANNEL_ID = production
  ? process.env.ATTENDANCE_CHANNEL_ID
  : process.env.TEST_CHANNEL_ID;

// Create Discord client
export const discordClient =
  global._discordClientGlobal ||
  new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.GuildVoiceStates,
    ],
    partials: [Partials.Message, Partials.Channel],
  });

// Store in global scope to ensure it's a singleton
global._discordClientGlobal = discordClient;

export const getGuildMember = async (discordId: string) => {
  if (!discordClient.isReady()) {
    throw new Error("Discord client is not ready");
  }
  if (!DISCORD_SERVER_ID) throw new Error("DISCORD_SERVER_ID not set");

  const guild = await discordClient.guilds.fetch(DISCORD_SERVER_ID);
  const member = await guild.members.fetch(discordId);
  return member;
};

// Discord login and initialization
export const initializeDiscord = async () => {
  // getWeekdayAvailabilityHeatmap("5e23ebb84d38965d54026712", 20)
  // getGroupWeekdayAvailabilityWindows(
  //   ["5e23ebb84d38965d54026712", "5e23ec834d38965d54026715"],
  //   0.5,
  //   120
  // ).then((r) => {
  //   console.log("Group weekday availability windows:", r);
  // });
  // // getWeekdayAvailabilityHeatmap("5e23ec834d38965d54026715", 20);

  // return discordClient; // Return early if already initialized
  if (!DISCORD_BOT_TOKEN) {
    console.error("DISCORD_BOT_TOKEN not set, Discord bot will not start");
    return;
  }

  if (!DISCORD_SERVER_ID) {
    console.error("DISCORD_SERVER_ID not set, Discord bot will not start");
    return;
  }

  if (!BOT_ID) {
    console.error("BOT_ID not set, Discord bot will not start");
    return;
  }

  try {
    console.log("Initializing Discord client...");

    // Connect Discord client
    await discordClient.login(DISCORD_BOT_TOKEN);
    console.log("\t Connected...✅");

    // Register event handlers
    setupEventHandlers();
    console.log("\t Event handlers registered...✅");

    // Register application commands
    await registerCommands();

    console.log("\t Commands registered...✅");
    // Start cron jobs (if any)
    await startCronJobs(discordClient); // Uncomment if you have cron jobs to start

    console.log("\t Cron jobs started...✅");

    return discordClient;
  } catch (error) {
    console.error("Failed to initialize Discord client:", error);
  }
};

const sendAttendanceChangeMessageAndSetStatus = (
  message: string,
  userDiscordId: string
) => {
  if (!ATTENDANCE_CHANNEL_ID) return;
  const channel = discordClient.channels.cache.get(ATTENDANCE_CHANNEL_ID);

  if (!channel || !(channel instanceof TextChannel)) {
    console.error("Attendance channel not found or is not a TextChannel");
    return;
  }
  channel.send(`<@${userDiscordId}> ${message}`);
  console.log(message.slice(0, 2).trim(), message);
  setNameStatus(discordClient, message.slice(0, 2).trim(), userDiscordId);
};

// Setup event handlers
function setupEventHandlers() {
  discordClient.on("ready", () => {
    console.log(`Logged in as ${discordClient.user?.tag}!`);

    // Setup voice state update handler
    discordClient.on("voiceStateUpdate", (oldState, newState) => {
      if (production) {
        handleVoiceStateChange(
          oldState,
          newState,
          sendAttendanceChangeMessageAndSetStatus
        );
      }
    });
  });

  // Handle interactions (slash commands)
  discordClient.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) {
      const id = interaction.customId;
      // Only handle meeting invite accept/reject buttons here.
      if (id.startsWith("mtg-accept-") || id.startsWith("mtg-reject-")) {
        const [_, action, meetingId] = id.split("-");
        try {
          const meeting = await getMeetingById(meetingId);
          if (!meeting || meeting.isCanceled) {
            await interaction.reply({
              content: "This meeting is no longer active.",
              flags: "Ephemeral",
            });
            return;
          }
          const { id: userId } = await getUserByDiscordId(interaction.user.id);
          await setMeetingRequestAcceptance(
            meetingId,
            userId,
            action === "accept"
          );
          await interaction.reply({
            content: `You have ${
              action === "accept" ? "accepted" : "rejected"
            } the meeting.`,
            flags: "Ephemeral",
          });
          const refreshed = await getMeetingById(meetingId);
          if (refreshed) {
            const total = refreshed.requests.length;
            const rejected = refreshed.requests.filter(
              (r) => r.rejectedAt && !r.requestAcceptedAt
            ).length;
            const accepted = refreshed.requests.filter(
              (r) => r.requestAcceptedAt
            ).length;
            if (total > 0 && rejected === total && accepted === 0) {
              await cancelMeeting(meetingId);
              const ch = await discordClient.channels.fetch(
                refreshed.channelId
              );
              if (ch && ch.isTextBased()) {
                await (ch as any).send({
                  content: `All invitees rejected. Meeting${
                    refreshed.title ? ` "${refreshed.title}"` : ""
                  } has been canceled.`,
                });
              }
            }
          }
        } catch (e) {
          console.error("Meeting button error:", e);
          if (!interaction.replied)
            await interaction.reply({
              content: "❌ Error handling your action.",
              flags: "Ephemeral",
            });
        }
      }
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    // Delegate all chat input commands to the centralized interaction handler
    await interactionHandler(interaction);
  });
}

// Register slash commands
async function registerCommands() {
  if (!DISCORD_BOT_TOKEN || !BOT_ID || !DISCORD_SERVER_ID) return;

  const commands = [
    authCommandBody,
    getNextHolidayAnnouncementCommandBody,
    requestLeaveCommandBody,
    meetingCommandBody,
  ];

  try {
    const rest = new REST().setToken(DISCORD_BOT_TOKEN);
    console.log(`Started refreshing ${commands.length} application commands`);

    await rest.put(Routes.applicationGuildCommands(BOT_ID, DISCORD_SERVER_ID), {
      body: commands,
    });

    console.log("Successfully registered application commands");
  } catch (error) {
    console.error("Failed to register commands:", error);
  }
}
