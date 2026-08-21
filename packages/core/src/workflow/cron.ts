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
    const [rangePart, stepText] = rawPart.split('/', 2);
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) return null;

    const range = rangePart === '*' ? [minimum, maximum] : rangePart.split('-', 2).map(Number);
    if (range.length === 1) {
      const value = range[0];
      if (!Number.isInteger(value) || value < minimum || value > maximum) return null;
      values.add(value);
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

export function parseCronExpression(expression: string): ParsedCronExpression | null {
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) return null;
  const [minute, hour, day, month, weekday] = fields;
  const parsedMinute = parseField(minute!, 0, 59);
  const parsedHour = parseField(hour!, 0, 23);
  const parsedDay = parseField(day!, 1, 31);
  const parsedMonth = parseField(month!, 1, 12);
  const parsedWeekday = parseField(weekday!, 0, 6);
  if (!parsedMinute || !parsedHour || !parsedDay || !parsedMonth || !parsedWeekday) return null;
  return {
    minute: parsedMinute,
    hour: parsedHour,
    day: parsedDay,
    month: parsedMonth,
    weekday: parsedWeekday,
    dayIsWildcard: day === '*',
    weekdayIsWildcard: weekday === '*',
  };
}

export function isValidCronExpression(expression: string): boolean {
  return parseCronExpression(expression) !== null;
}
