import { describe, expect, it } from 'vitest';
import { activityDayLabel, groupByDay } from './format.js';

describe('activity day headings', () => {
  const now = new Date(2026, 9, 10, 15, 0);

  it('names today and yesterday, and dates further back', () => {
    expect(activityDayLabel(new Date(2026, 9, 10, 6, 6).toISOString(), now)).toBe('오늘');
    expect(activityDayLabel(new Date(2026, 9, 9, 23, 59).toISOString(), now)).toBe('어제');
    expect(activityDayLabel(new Date(2026, 9, 7, 9, 0).toISOString(), now)).toContain('10월 7일');
    expect(activityDayLabel(new Date(2025, 11, 31, 9, 0).toISOString(), now)).toContain('2025');
  });

  it('keeps the listed order and starts a group at each new day', () => {
    const runs = [
      { id: 'a', startedAt: new Date(2026, 9, 10, 9).toISOString() },
      { id: 'b', startedAt: new Date(2026, 9, 10, 8).toISOString() },
      { id: 'c', startedAt: new Date(2026, 9, 9, 8).toISOString() },
    ];
    expect(groupByDay(runs, now).map((group) => [group.label, group.runs.map((run) => run.id)]))
      .toEqual([['오늘', ['a', 'b']], ['어제', ['c']]]);
  });
});
