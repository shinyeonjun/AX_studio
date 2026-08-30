import { describe, expect, it } from 'vitest';
import { cronMatches } from '../runtime/scheduler.js';
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

  it('treats stepped wildcard calendar fields as wildcard-based', () => {
    const parsed = parseCronExpression('0 9 */2 * */3');

    expect(parsed?.dayIsWildcard).toBe(true);
    expect(parsed?.weekdayIsWildcard).toBe(true);
  });

  it('does not let a stepped day wildcard override a weekday restriction', () => {
    const wednesday = new Date('2026-08-05T09:00:00Z');

    expect(cronMatches('0 9 */2 * 1', wednesday, 'UTC')).toBe(false);
  });

  it.each([
    '1-2-3 * * * *',
    '*/2/3 * * * *',
  ])('rejects extra field separators in %s', (expression) => {
    expect(parseCronExpression(expression)).toBeNull();
  });

  it.each([
    '-5 * * * *',
    '+5 * * * *',
    '0x10 * * * *',
    '1e1 * * * *',
    '*/+2 * * * *',
  ])('rejects non-decimal numeric syntax in %s', (expression) => {
    expect(parseCronExpression(expression)).toBeNull();
  });
});
