import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  TextChannel,
} from "discord.js";

import { config } from "dotenv";
config();
// Environment variables
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const DISCORD_SERVER_ID = process.env.DISCORD_SERVER_ID;
const BOT_ID = process.env.BOT_ID;
const ATTENDANCE_CHANNEL_ID =
  process.env.NODE_ENV === "production"
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
    console.log("Discord client connected successfully");

    // Register event handlers
    // setupEventHandlers();

    // Register application commands
    // await registerCommands();

    return discordClient;
  } catch (error) {
    console.error("Failed to initialize Discord client:", error);
  }
};

// Setup event handlers
function setupEventHandlers() {
  discordClient.on("ready", () => {
    console.log(`Logged in as ${discordClient.user?.tag}!`);

    // Setup voice state update handler
    discordClient.on("voiceStateUpdate", (oldState, newState) => {
      // Implement voice state handling logic here
      console.log("Voice state updated");
    });

    // Post startup message
    if (ATTENDANCE_CHANNEL_ID) {
      const channel = discordClient.channels.cache.get(
        ATTENDANCE_CHANNEL_ID
      ) as TextChannel;
      if (channel) {
        channel.send("HR Bot is now online!");
      }
    }
  });

  // Handle interactions (slash commands)
  discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    // Handle different commands
    switch (interaction.commandName) {
      // Implement your command handlers here
      default:
        await interaction.reply("Unknown command");
    }
  });
}

// Register slash commands
async function registerCommands() {
  if (!DISCORD_BOT_TOKEN || !BOT_ID || !DISCORD_SERVER_ID) return;

  const commands = [
    // Define your commands here
    {
      name: "hr",
      description: "Access the HR system",
    },
    // Add more commands as needed
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
