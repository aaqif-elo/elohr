import { Client, GuildMember } from "discord.js";
import { platform } from "os";
import { launch, LaunchOptions } from "puppeteer";

// Queue system for attendance image reports
let isProcessingImageQueue = false;
const imageReportQueue: Array<{
  token: string;
  isAdmin: boolean;
  resolve: (buffer: Buffer | null) => void;
}> = [];

// Generate a text attendance report from attendance data
export function generateTextAttendanceReport(attendance: any): string {
  if (!attendance) return "No attendance data found";
  
  const loginTime = new Date(attendance.login).toLocaleTimeString();
  const logoutTime = attendance.logout ? new Date(attendance.logout).toLocaleTimeString() : "N/A";
  const totalWorkHours = (attendance.totalWork || 0) / (1000 * 60 * 60);
  const totalBreakMinutes = (attendance.totalBreak || 0) / (1000 * 60);
  
  return `**Attendance Summary**
Login time: ${loginTime}
Logout time: ${logoutTime}
Total work: ${totalWorkHours.toFixed(2)} hours
Total breaks: ${totalBreakMinutes.toFixed(0)} minutes`;
}

// Process one image report at a time from the queue
async function processImageReportQueue() {
  if (isProcessingImageQueue || imageReportQueue.length === 0) return;
  
  isProcessingImageQueue = true;
  const {token, isAdmin, resolve} = imageReportQueue.shift()!;
  
  try {
    const buffer = await getAttendanceStatsImageInternal(token, isAdmin);
    resolve(buffer);
  } catch (error) {
    console.error("Error generating image report:", error);
    resolve(null);
  } finally {
    isProcessingImageQueue = false;
    // Process next item in queue
    setTimeout(processImageReportQueue, 100);
  }
}

// Queue an attendance image report generation and return a promise
export function queueAttendanceStatsImage(token: string, isAdmin = false): Promise<Buffer | null> {
  return new Promise((resolve) => {
    imageReportQueue.push({token, isAdmin, resolve});
    // Start processing if not already running
    if (!isProcessingImageQueue) {
      processImageReportQueue();
    }
  });
}

// Internal function that actually generates the image
async function getAttendanceStatsImageInternal(token: string, isAdmin = false) {
  const browserConfig: LaunchOptions = {
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  };
  if (platform() === "linux") {
    browserConfig["executablePath"] = "/usr/bin/chromium-browser";
  }
  const browser = await launch(browserConfig);
  const page = await browser.newPage();
  page.emulateMediaFeatures([
    {
      name: "prefers-color-scheme",
      value: "dark",
    },
  ]);
  // Set the viewport size
  await page.setViewport({ width: 1920, height: 1080 });
  // inject JWT into localStorage on every new document before any script runs
  await page.evaluateOnNewDocument((token: string) => {
    window.localStorage.setItem("authJWT", token);
  }, token);

  await page.goto("http://localhost:2500/home", {
    waitUntil: ["domcontentloaded", "load"],
  });

  // Wait for content to be present
  try {
    await page.waitForFunction(
      () => {
        // Check if we're past the login screen and showing actual attendance data
        const attendanceElements = document.querySelectorAll("svg circle");
        const timeDisplay = document.querySelector("svg text");
        return attendanceElements.length > 0 && timeDisplay !== null;
      },
      { timeout: 10000 }
    );
  } catch (error) {
    console.error("Timeout waiting for attendance data:", error);
    // Continue anyway and take whatever is on screen
  }

  const employeeClip = {
    x: 50,
    y: 245,
    width: 1820,
    height: 625,
  };

  const adminClip = {
    x: 175,
    y: 0,
    width: 1575,
    height: 1275,
  };

  // Take a screenshot of the page
  const buffer = await page.screenshot({
    encoding: "binary",
    type: "png",
    clip: isAdmin ? adminClip : employeeClip,
  });
  await browser.close();
  return Buffer.from(buffer);
}

// Public function that now just queues the generation task
export const getAttendanceStatsImage = queueAttendanceStatsImage;

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
