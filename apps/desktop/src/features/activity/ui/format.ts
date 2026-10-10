export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** The time of day a run started ("오전 06:06"); the day is the group it is listed under. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/** The day heading a run is listed under: 오늘, 어제, or the date with its weekday. */
export function activityDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '날짜 모름';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return '오늘';
  if (dayKey(date) === dayKey(yesterday)) return '어제';
  return date.toLocaleDateString('ko-KR', {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  });
}

/** Runs in their listed order, cut into consecutive groups that share a day heading. */
export function groupByDay<T extends { startedAt: string }>(runs: T[], now: Date = new Date()): Array<{ label: string; runs: T[] }> {
  const groups: Array<{ label: string; runs: T[] }> = [];
  for (const run of runs) {
    const label = activityDayLabel(run.startedAt, now);
    const last = groups.at(-1);
    if (last?.label === label) last.runs.push(run);
    else groups.push({ label, runs: [run] });
  }
  return groups;
}

export { formatFileSize } from '../../../ui/lib/format-file-size.js';
