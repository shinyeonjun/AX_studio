import { isValidTimeZone } from '../cron.js';

/** Local wall-clock reading of an instant in an IANA time zone. */
export interface LocalDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The machine's IANA time zone, or Asia/Seoul when it cannot be resolved. */
export function localTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (zone && isValidTimeZone(zone)) return zone;
  } catch {
    // fall through
  }
  return 'Asia/Seoul';
}

function formattedParts(instant: number, timeZone: string): LocalDateTime {
  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: value('year'), month: value('month'), day: value('day'), hour: value('hour'), minute: value('minute') };
}

/**
 * UTC offsets are cached per zone and quarter hour. Since 1972 every tzdb offset
 * is a whole number of minutes and transitions fall on quarter-hour UTC instants,
 * so one Intl lookup is valid for the whole bucket. The cache is bounded.
 */
const OFFSET_BUCKET_MS = 15 * MINUTE_MS;
const MAX_CACHED_OFFSETS = 50_000;
const offsetCache = new Map<string, number>();

/** UTC offset (wall clock minus instant) in milliseconds. O(1) amortized. */
function offsetAt(instant: number, timeZone: string): number {
  const bucket = Math.floor(instant / OFFSET_BUCKET_MS) * OFFSET_BUCKET_MS;
  const key = timeZone + '|' + bucket;
  let offset = offsetCache.get(key);
  if (offset === undefined) {
    const local = formattedParts(bucket, timeZone);
    offset = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute) - bucket;
    if (offsetCache.size >= MAX_CACHED_OFFSETS) offsetCache.clear();
    offsetCache.set(key, offset);
  }
  return offset;
}

export function zonedDateTime(instant: number, timeZone: string): LocalDateTime {
  const minute = Math.floor(instant / MINUTE_MS) * MINUTE_MS;
  const wall = new Date(minute + offsetAt(minute, timeZone));
  return {
    year: wall.getUTCFullYear(),
    month: wall.getUTCMonth() + 1,
    day: wall.getUTCDate(),
    hour: wall.getUTCHours(),
    minute: wall.getUTCMinutes(),
  };
}

function wallAt(instant: number, timeZone: string): number {
  const minute = Math.floor(instant / MINUTE_MS) * MINUTE_MS;
  return minute + offsetAt(minute, timeZone);
}

function exactInstants(wall: number, timeZone: string): { offsets: number[]; instants: number[] } {
  // Samples far enough apart to see the offsets on both sides of a nearby transition.
  const offsets = [...new Set([offsetAt(wall - 30 * 3_600_000, timeZone), offsetAt(wall + 30 * 3_600_000, timeZone)])];
  const instants = [...new Set(offsets.map((offset) => wall - offset))]
    .filter((instant) => wallAt(instant, timeZone) === wall)
    .sort((left, right) => left - right);
  return { offsets, instants };
}

/** Every instant whose wall clock reads exactly this local time: none (gap), one, or two (repeated hour). */
export function exactLocalInstants(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number[] {
  return exactInstants(Date.UTC(year, month - 1, day, hour, minute), timeZone).instants;
}

/**
 * Resolves a local wall-clock time to an instant (ms, minute-aligned).
 * - Ambiguous time (clocks fall back): the earlier instant, so it runs once.
 * - Nonexistent time (clocks jump forward): the first instant after the gap,
 *   i.e. the moment the clock jumps (02:30 on a 02:00→03:00 day runs at 03:00).
 */
export function resolveLocalTime(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const { offsets, instants } = exactInstants(wall, timeZone);
  if (instants.length > 0) return instants[0]!;
  if (offsets.length === 1) {
    // Two transitions within the sample window (rare); fall back to denser samples.
    for (const hours of [-12, 0, 12]) offsets.push(offsetAt(wall + hours * 3_600_000, timeZone));
  }
  const smallest = Math.min(...offsets);
  const largest = Math.max(...offsets);
  // Gap: before the jump the wall clock reads earlier than `wall`, after it reads later.
  let low = wall - largest;
  let high = wall - smallest;
  if (wallAt(high, timeZone) <= wall) return high;
  while (high - low > MINUTE_MS) {
    const middle = low + Math.floor((high - low) / 2 / MINUTE_MS) * MINUTE_MS;
    if (wallAt(middle, timeZone) > wall) high = middle;
    else low = middle;
  }
  return high;
}

/** Days since 1970-01-01 for a civil date. */
export function dayNumber(year: number, month: number, day: number): number {
  return Math.round(Date.UTC(year, month - 1, day) / DAY_MS);
}

export function civilDate(dayNo: number): { year: number; month: number; day: number } {
  const date = new Date(dayNo * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** 0 = Monday … 6 = Sunday. */
export function mondayIndex(dayNo: number): number {
  return (((dayNo + 3) % 7) + 7) % 7;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function localDayNumber(instant: number, timeZone: string): number {
  const local = zonedDateTime(instant, timeZone);
  return dayNumber(local.year, local.month, local.day);
}
