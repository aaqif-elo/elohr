/**
 * Format a duration in milliseconds into a human-readable worked-time string.
 * Examples:
 *   4500000 -> "1.25 Hours (1 Hour 15 Mins)"
 *   7200000 -> "2.00 Hours (2 Hours)"
 *    600000 -> "10 Mins"
 */
export function formatWorkedDuration(ms: number): string {
  const totalMins = Math.round(ms / 60000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const decimalHours = (ms / 3600000).toFixed(2);
  const hoursLabel = `${hours} ${hours === 1 ? "Hour" : "Hours"}`;
  const minsLabel = `${mins} ${mins === 1 ? "Min" : "Mins"}`;

  if (hours > 0 && mins > 0) {
    return `${decimalHours} Hours (${hoursLabel} ${minsLabel})`;
  }
  if (hours > 0) {
    return `${decimalHours} Hours (${hoursLabel})`;
  }
  return minsLabel;
}
