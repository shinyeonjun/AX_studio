import { describe, expect, it } from 'vitest';
import { parseCronExpression } from './cron.js';

describe('parseCronExpression', () => {
  it('expands a step after a single value through the field maximum', () => {
    const parsed = parseCronExpression('5/10 * * * *');

    expect([...parsed!.minute]).toEqual([5, 15, 25, 35, 45, 55]);
  });

  it('keeps an unstepped single value singular', () => {
    const parsed = parseCronExpression('5 * * * *');

    expect([...parsed!.minute]).toEqual([5]);
  });

  it('accepts 7 as the Sunday alias', () => {
    const parsed = parseCronExpression('0 9 * * 7');

    expect(parsed?.weekday).toEqual(new Set([0]));
  });

  it.each([
    '1-2-3 * * * *',
    '*/2/3 * * * *',
  ])('rejects extra field separators in %s', (expression) => {
    expect(parseCronExpression(expression)).toBeNull();
  });
});
