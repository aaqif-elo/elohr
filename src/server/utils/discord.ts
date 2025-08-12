export type DiscordTimestampStyle = "t" | "T" | "d" | "D" | "f" | "F" | "R";

/**
 * Format a Date or epoch milliseconds into a Discord dynamic timestamp.
 * @param input Date or epoch ms
 * @param style Discord timestamp style token (default: 'F')
 * @returns String like <t:1577836800:F>
 */
export function discordTimestamp(
  input: Date | number,
  style: DiscordTimestampStyle = "F"
): string {
  const epochMs = typeof input === "number" ? input : input.getTime();
  const epochSeconds = Math.floor(epochMs / 1000);
  return `<t:${epochSeconds}:${style}>`;
}
