import type { GuildMember } from "discord.js";
import { getGuildMember } from ".";

// Checks if the nickname starts with the available status tag
function hasStatus(nickname: string | null): boolean {
  if (!nickname) {
    return false;
  }
  return (
    nickname.match(new RegExp(`^${process.env.STATUS_TAG_AVAILABLE}`, "g")) !== null
  );
}

// Only STATUS_TAG_AVAILABLE is a valid tag in hourly mode
function isValidTag(statusTag: string): boolean {
  return statusTag === process.env.STATUS_TAG_AVAILABLE;
}

// Given a Discord GuildMember
// Return if the GuildMember is an Admin of elo Team
function isAdmin(member: GuildMember): boolean {
  return member.roles.highest.id === process.env.ADMIN_ROLE_ID;
}

// A function to set the status of a person using his/her nickname
// The function connects to a discord server using discordClient and serverID
// It then finds the member using the discriminator
// The nickname is then modified to add the status tag at [status] at the end of the name
// Any part of the nickname starting with [ is going to be overwritten
export async function setNameStatus(
  status: string, // The status to be set
  id: string, // The Discord Id (UUID) for the user
) {
  if (!isValidTag(status)) {
    // Reject if the status tag is invalid
    return;
  }

  const member = await getGuildMember(id);

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
        ? `${status}${member.nickname?.substring(1) ?? ""}`.substring(0, 32) // Replace the previous statusTag
        : `${status}${member.nickname}`.substring(0, 32), // Don't replace the previous statusTag
    );
  } catch (err) {
    console.error(err);
    return;
  }
}

export async function clearNameStatus(id: string) {
  const member = await getGuildMember(id);

  if (!member) {
    console.error("Member not found");
    return;
  }

  if (isAdmin(member)) return;

  const current = member.nickname ?? member.user.displayName;
  if (!hasStatus(current)) return;

  try {
    await member.setNickname(current.substring(1).trim().substring(0, 32));
  } catch (err) {
    console.error(err);
  }
}
