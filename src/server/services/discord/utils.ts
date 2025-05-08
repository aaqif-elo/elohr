import { Client, GuildMember } from "discord.js";
import { launch } from "puppeteer";

export const getAttendanceStatsImage = async (token: string) => {
  const browser = await launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  // Set the viewport size
  await page.setViewport({ width: 1300, height: 700 });
  // inject JWT into localStorage on every new document before any script runs
  await page.evaluateOnNewDocument((token: string) => {
    window.localStorage.setItem("authJWT", token);
  }, token);
  await page.goto("http://localhost:2500/home", { waitUntil: "networkidle0" });

  await page.waitForSelector("#app");
  // Set local storage with the JWT
  await page.evaluate((token) => {
    localStorage.setItem("authJWT", token);
  }, token);
  // Navigate to the page that uses the JWT

  // Wait for the page to load
  await page.waitForSelector("#app");
  // Take a screenshot of the page
  const buffer = await page.screenshot({
    encoding: "binary",
    type: "png",
    fullPage: true,
  });
  await browser.close();
  return Buffer.from(buffer);
};

// Checks if the nickname contains any of the status tags
function hasStatus(nickname: string | null): boolean {
  if (!nickname) {
    return false;
  }
  return (
    nickname.match(new RegExp(`^${process.env.STATUS_TAG_AVAILABLE}`, "g")) !==
      null || // Check if the nickname starts with STATUS_TAG_AVAILABLE
    nickname.match(
      new RegExp(`^${process.env.STATUS_TAG_UNAVAILABLE}`, "g")
    ) !== null || // Check if the nickname starts with STATUS_TAG_UNAVAILABLE
    nickname.match(new RegExp(`^${process.env.STATUS_TAG_BREAK}`, "g")) !== null // Check if the nickname starts with STATUS_TAG_BREAK
  );
}

// Checks if the provided status tag is valid
function isValidTag(statusTag: string): boolean {
  return (
    statusTag === process.env.STATUS_TAG_AVAILABLE || // Check if the statusTag equals STATUS_TAG_AVAILABLE
    statusTag === process.env.STATUS_TAG_UNAVAILABLE || // Check if the statusTag equals STATUS_TAG_UNAVAILABLE
    statusTag === process.env.STATUS_TAG_BREAK // Check if the statusTag equals STATUS_TAG_BREAK
  );
}

// Given a Discord GuildMember
// Return if the GuildMember is an Admin of elo Team
export function isAdmin(member: GuildMember): boolean {
  return member.roles.highest.id === process.env.ADMIN_ROLE_ID;
}

// A function to set the status of a person using his/her nickname
// The function connects to a discord server using discordClient and serverID
// It then finds the member using the discriminator
// The nickname is then modified to add the status tag at [status] at the end of the name
// Any part of the nickname starting with [ is going to be overwritten
export async function setNameStatus(
  discordClient: Client, // Discord Client
  status: string, // The status to be set
  id: string // The Discord Id (UUID) for the user
) {
  if (!isValidTag(status)) {
    console.error("Invalid ", status);
    // Reject if the status tag is invalid
    return;
  }

  const member = (
    await (
      await discordClient.guilds.fetch(process.env.DISCORD_SERVER_ID!)
    ).members.fetch()
  ).get(id);

  if (!member) {
    console.error("Member not found");
    return;
  }

  try {
    // Don't try to change nickname if admin
    if (isAdmin(member)) {
      return;
    }
    await member.setNickname(
      // Set the nickname
      hasStatus(member.nickname) // Check if any status already applied
        ? `${status}${member.nickname!.substring(1)}`.substring(0, 32) // Replace the previous statusTag
        : `${status}${member.nickname}`.substring(0, 32) // Don't replace the previous statusTag
    );
  } catch (err) {
    console.error(err);
    return;
  }
}
