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
});
