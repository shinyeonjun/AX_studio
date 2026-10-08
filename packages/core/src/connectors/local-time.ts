/**
 * A time as this computer's local "2026-10-08 10:12": readable to people, and in an order that a
 * sort by date gets right. Read results add it beside the provider's raw time, which stays as is.
 */
export function localDateTime(time: Date): string | undefined {
  if (Number.isNaN(time.getTime())) return undefined;
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${time.getFullYear()}-${pad(time.getMonth() + 1)}-${pad(time.getDate())} ${pad(time.getHours())}:${pad(time.getMinutes())}`;
}

/** A Slack message timestamp ("1791436353.000200", seconds since 1970) as local time. */
export function slackLocalTime(ts: string): string | undefined {
  const seconds = Number(ts);
  return Number.isFinite(seconds) && seconds > 0 ? localDateTime(new Date(seconds * 1000)) : undefined;
}
