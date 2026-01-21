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
import { availabilityCommandBody } from "./commands";

import { interactionHandler } from "./interaction-handlers";
import {
  getMeetingById,
  setMeetingRequestAcceptance,
  cancelMeeting,
  getUserByDiscordId,
  getDiscordIdsFromUserIds,
} from "../../db";
import { handleVoiceStateChange } from "./voice-channel-hook.service";
import { setNameStatus } from "./utils";
import { startCronJobs } from "./cron-jobs";
import { discordTimestamp } from "../../utils/discord";
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
    process.exit(1);
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
  setNameStatus(message.slice(0, 2).trim(), userDiscordId);
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
            if (!interaction.replied && !interaction.deferred) {
              await interaction.reply({
                content: "This meeting is no longer active.",
                flags: "Ephemeral",
              });
            }
            return;
          }
          const { id: userId } = await getUserByDiscordId(interaction.user.id);
          await setMeetingRequestAcceptance(
            meetingId,
            userId,
            action === "accept"
          );

          // Build confirmation text (more details on acceptance)
          const refreshed = await getMeetingById(meetingId);
          const titlePart = refreshed?.title ? `: **${refreshed.title}**` : "";
          let confirmationText = `You have ${
            action === "accept" ? "accepted" : "rejected"
          } the invite to a meeting${titlePart}.`;
          if (action === "accept" && refreshed) {
            const channelMention = `<#${refreshed.channelId}>`;
            const whenFancy = `${discordTimestamp(refreshed.startTime, "F")} (${
              refreshed.durationMins
            } mins, ${discordTimestamp(refreshed.startTime, "R")})`;
            try {
              const acceptedUserIds = refreshed.requests
                .filter((r) => !!r.requestAcceptedAt && !r.rejectedAt)
                .map((r) => r.userId);
              const mappings = await getDiscordIdsFromUserIds(acceptedUserIds);
              const attendeeMentions = mappings
                .map((m) => `<@${m.discordId}>`)
                .join(" ");
              confirmationText = `You have accepted the invite to a meeting${titlePart}.
• Channel: ${channelMention}
• When: ${whenFancy}
• Attending: ${attendeeMentions || "(none yet)"}`;
            } catch {
              // Fallback to base text if mapping fails
              confirmationText = `You have accepted the invite to a meeting${titlePart}.`;
            }
          }

          // Only edit the original message in DMs to avoid changing a shared channel message.
          const isDM = !interaction.inGuild();
          if (isDM && interaction.message && interaction.message.editable) {
            try {
              await interaction.update({
                content: confirmationText,
                components: [],
              });
            } catch {
              if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({
                  content: confirmationText,
                  flags: "Ephemeral",
                });
              }
            }
          } else if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              content: confirmationText,
              flags: "Ephemeral",
            });
          }

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
          if (!interaction.replied && !interaction.deferred)
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
    availabilityCommandBody,
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
