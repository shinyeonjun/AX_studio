import { describe, expect, it } from 'vitest';
import type { AxCommand } from '../../schema.js';
import { applyJevCommandInputValuesToCommand, compileJevActionParams, jevActionQuotedInputMapping } from './action-catalog.js';
import { GMAIL_CAPABILITIES } from '../../../../../connectors/gmail/catalog.js';
import { encodeScheduleInputValue } from '../../../../../workflow/schedule/input-value.js';

describe('Jev command input continuation', () => {
  it('applies scoped answers to an upserted action in workflow.update', () => {
    const pending: AxCommand = {
      name: 'workflow.update',
      args: {
        workflowId: 'workflow-1',
        baseVersion: 4,
        operations: [
          { op: 'set', path: 'name', value: '메일 업무' },
          {
            op: 'upsert_step',
            step: {
              type: 'action',
              id: 'jev_step_2',
              connector: 'gmail',
              action: 'message.send',
              actionRef: 'gmail.message.send@1',
              params: {},
            },
          },
          { op: 'remove_step', stepId: 'obsolete-step' },
        ],
      },
    };

    expect(applyJevCommandInputValuesToCommand(pending, [
      {
        label: '수신자', value: 'person@example.com', stepId: 'jev_step_2',
        capabilityId: 'gmail.message.send', parameterName: 'to',
      },
      {
        label: '본문', value: '견적 안내', stepId: 'jev_step_2',
        capabilityId: 'gmail.message.send', parameterName: 'body',
      },
      {
        label: '본문', value: '엉뚱한 단계에는 적용하지 않음', stepId: 'jev_step_1',
        capabilityId: 'gmail.message.send', parameterName: 'body',
      },
    ])).toEqual({
      name: 'workflow.update',
      args: {
        workflowId: 'workflow-1',
        baseVersion: 4,
        operations: [
          { op: 'set', path: 'name', value: '메일 업무' },
          {
            op: 'upsert_step',
            step: expect.objectContaining({
              id: 'jev_step_2',
              params: { to: 'person@example.com', body: '견적 안내' },
            }),
          },
          { op: 'remove_step', stepId: 'obsolete-step' },
        ],
      },
    });
  });

  it('replaces a blank or legacy schedule with the recurrence chosen in the schedule form', () => {
    const recurrence = {
      kind: 'recurrence' as const, freq: 'monthly' as const, interval: 1, byMonthDay: [-1],
      times: [{ hour: 18, minute: 0 }], anchor: '2026-10-06', timezone: 'America/New_York',
    };
    const pending = (trigger: Record<string, unknown>): AxCommand => ({
      name: 'job.propose',
      args: { name: '월말 보고', goal: '월말 보고', trigger, steps: [{ type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#a', text: 'x' } }] },
    });
    const value = { label: '실행 일정', value: encodeScheduleInputValue(recurrence), target: 'trigger' as const, parameterName: 'recurrence' };
    for (const trigger of [{ type: 'schedule', schedule: '', timezone: '' }, { type: 'schedule', schedule: '0 9 * * *', timezone: 'Asia/Seoul' }]) {
      const applied = applyJevCommandInputValuesToCommand(pending(trigger), [value]);
      expect((applied?.args as { trigger: unknown }).trigger).toEqual({ type: 'schedule', recurrence, timezone: 'America/New_York' });
    }
    // A tampered or unreadable value leaves the schedule untouched, so host validation asks again.
    const tampered = { ...value, value: '매월 마지막 날 오후 6:00 ⟦일정:e30⟧' };
    expect((applyJevCommandInputValuesToCommand(pending({ type: 'schedule', schedule: '', timezone: '' }), [tampered])?.args as { trigger: unknown }).trigger)
      .toEqual({ type: 'schedule', schedule: '', timezone: '' });
  });
});

describe('fields a request names', () => {
  const send = GMAIL_CAPABILITIES.find((capability) => capability.id === 'gmail.message.send')!;

  it('reads a label written right before a quoted value, as people write it', () => {
    const message = 'me@example.com 으로 제목 "주간 보고", 본문 "이번 주 보고입니다" 메일 보내줘';
    expect(compileJevActionParams(send, message)).toEqual({ to: 'me@example.com', subject: '주간 보고', body: '이번 주 보고입니다' });
    expect(jevActionQuotedInputMapping(send, message)).toBeUndefined();
  });

  it('never takes an unquoted word after a bare label as its value', () => {
    expect(compileJevActionParams(send, 'me@example.com 에게 제목 없이 본문 보내줘')).toEqual({ to: 'me@example.com' });
  });
});
