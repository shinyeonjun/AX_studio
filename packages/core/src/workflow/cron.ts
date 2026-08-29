export interface ParsedCronExpression {
  minute: Set<number>;
  hour: Set<number>;
  day: Set<number>;
  month: Set<number>;
  weekday: Set<number>;
  dayIsWildcard: boolean;
  weekdayIsWildcard: boolean;
}

function parseField(field: string, minimum: number, maximum: number): Set<number> | null {
  const values = new Set<number>();
  for (const rawPart of field.split(',')) {
    if (!rawPart) return null;
    const stepParts = rawPart.split('/');
    if (stepParts.length > 2) return null;
    const [rangePart, stepText] = stepParts;
    if (stepText !== undefined && !/^\d+$/.test(stepText)) return null;
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;

    const rangeParts = rangePart!.split('-');
    if (rangeParts.length > 2) return null;
    if (rangePart !== '*' && rangeParts.some((part) => !/^\d+$/.test(part))) return null;
    const range = rangePart === '*' ? [minimum, maximum] : rangeParts.map(Number);
    if (range.length === 1) {
      const value = range[0];
      if (!Number.isInteger(value) || value < minimum || value > maximum) return null;
      if (stepText === undefined) {
        values.add(value);
        continue;
      }
      for (let steppedValue = value; steppedValue <= maximum; steppedValue += step) {
        values.add(steppedValue);
      }
      continue;
    }

    const [start, end] = range;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < minimum ||
      end > maximum ||
      start > end
    ) {
      return null;
    }
    for (let value = start; value <= end; value += step) values.add(value);
  }
  return values.size > 0 ? values : null;
}

function parseWeekdayField(field: string): Set<number> | null {
  const weekdays = parseField(field, 0, 7);
  if (!weekdays) return null;
  if (weekdays.delete(7)) weekdays.add(0);
  return weekdays;
}

export function parseCronExpression(expression: string): ParsedCronExpression | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields;
  const parsedMinute = parseField(minute!, 0, 59);
  const parsedHour = parseField(hour!, 0, 23);
  const parsedDay = parseField(day!, 1, 31);
  const parsedMonth = parseField(month!, 1, 12);
  const parsedWeekday = parseWeekdayField(weekday!);
  if (!parsedMinute || !parsedHour || !parsedDay || !parsedMonth || !parsedWeekday) return null;
  return {
    minute: parsedMinute,
    hour: parsedHour,
    day: parsedDay,
    month: parsedMonth,
    weekday: parsedWeekday,
    dayIsWildcard: day.startsWith('*'),
    weekdayIsWildcard: weekday.startsWith('*'),
  };
}

export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression) !== null;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}
