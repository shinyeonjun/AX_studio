import { describe, expect, it } from 'vitest';
import type { WorkflowIR } from '../schema.js';
import { describeSchedule, nextScheduleRuns } from './describe.js';
import { validateTriggerConfiguration } from '../contract-validation/structure/trigger.js';
import { computeRequiredSlots } from '../canvas/slots/requiredness/compute.js';

// Stored or older workflows can carry a schedule field that is not text; reading one must not throw.
const malformed = { schedule: { cron: '0 9 * * 1' }, timezone: 42 } as unknown as { schedule?: string; timezone?: string };

describe('a schedule field that is not text', () => {
  it('reads as no schedule when described or asked for its next runs', () => {
    expect(describeSchedule(malformed)).toBe('');
    expect(nextScheduleRuns(malformed, new Date('2026-10-10T00:00:00Z'), 3)).toEqual([]);
  });

  it('is reported as a missing schedule instead of throwing', () => {
    const ir = { trigger: { type: 'schedule', ...malformed } } as unknown as WorkflowIR;
    expect(validateTriggerConfiguration(ir).map((issue) => issue.message)).toEqual(['반복 업무에 실행 일정이 필요합니다.']);
  });

  it('leaves the schedule question open', () => {
    const ir = { goal: '주간 요약', trigger: { type: 'schedule', ...malformed }, steps: [] } as unknown as WorkflowIR;
    expect(computeRequiredSlots(ir).find((slot) => slot.slot === 'trigger.schedule')?.filled).toBe(false);
  });
});

describe('a trigger drawn from damaged draft fields', () => {
  it('describes the trigger with the damaged fields left out', async () => {
    const { triggerParamValues } = await import('../visual-display/trigger-display/values.js');
    const draft = { triggerType: 'schedule', ...malformed } as never;
    expect(triggerParamValues(draft)).toEqual({ schedule: undefined, timezone: undefined });
    expect(triggerParamValues({ triggerType: 'slack.new_message', slackChannel: 7 } as never)).toEqual({ channel: undefined });
  });
});
