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
  logoutCommandBody,
  breakCommandBody,
  getNextHolidayAnnouncementCommandBody,
  setNextHolidayAnnouncementCommandBody,
  requestLeaveCommandBody,
  announceNextHolidayCommandBody,
} from "./commands";

import { config } from "dotenv";
import {
  EAdminCommands,
  EAttendanceCommands,
  EAuthCommands,
  ELeaveCommands,
} from "./discord.enums";
import { interactionHandler } from "./interaction-handlers";
import { handleVoiceStateChange } from "./voice-channel-hook.service";
import { setNameStatus } from "./utils";
import { startCronJobs } from "./cron-jobs";
config();
// Environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_SERVER_ID = process.env.DISCORD_SERVER_ID;
const BOT_ID = process.env.BOT_ID;
const production = process.env.NODE_ENV === "production";
const ATTENDANCE_CHANNEL_ID = production
  ? process.env.ATTENDANCE_CHANNEL_ID
  : process.env.TEST_CHANNEL_ID;

// Create Discord client
export const discordClient = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Message, Partials.Channel],
});

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
      // if (production) {
      handleVoiceStateChange(
        oldState,
        newState,
        sendAttendanceChangeMessageAndSetStatus
      );
      // }
    });
  });

  // Handle interactions (slash commands)
  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const validInteractions = [
      ...Object.values(EAttendanceCommands),
      ...Object.values(EAdminCommands),
      ...Object.values(ELeaveCommands),
      ...Object.values(EAuthCommands),
    ];

    if (
      !validInteractions.includes(
        interaction.commandName as EAttendanceCommands
      )
    ) {
      interaction.reply({
        content: `<@${interaction.user.id}> ❌ Invalid command!`,
        flags: "Ephemeral",
      });
      return;
    }

    interactionHandler(interaction, discordClient);
  });
}

// Register slash commands
async function registerCommands() {
  if (!DISCORD_BOT_TOKEN || !BOT_ID || !DISCORD_SERVER_ID) return;

  const commands = [
    logoutCommandBody,
    breakCommandBody,
    authCommandBody,
    getNextHolidayAnnouncementCommandBody,
    setNextHolidayAnnouncementCommandBody,
    requestLeaveCommandBody,
    announceNextHolidayCommandBody,
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
