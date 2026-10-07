const KOREAN_UNITS: Record<string, number> = { 천: 1_000, 만: 10_000, 억: 100_000_000 };

/**
 * The numbers a request states, as written and with a Korean unit applied ("5만원" -> 5 and 50000,
 * "1.5천" -> 1.5 and 1500); Jev picks the one the condition means and never invents another.
 */
export function numericValues(message: string): number[] {
  const values = new Set<number>();
  for (const match of message.matchAll(/(-?\d[\d,]*(?:\.\d+)?)\s*([천만억])?/gu)) {
    const value = Number(match[1]!.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    values.add(value);
    const unit = match[2] ? KOREAN_UNITS[match[2]] : undefined;
    if (unit) values.add(Math.round(value * unit * 1e6) / 1e6);
  }
  return [...values];
}
