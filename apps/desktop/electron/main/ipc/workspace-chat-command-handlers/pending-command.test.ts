import { beforeEach, describe, expect, it } from 'vitest';
import {
  claimPendingCommand,
  bindPendingCommandInputRequests,
  clearPendingCommand,
  finishClaimedPendingCommand,
  rememberPendingCommand,
  replaceClaimedPendingCommand,
} from './pending-command.js';

const command = (goal: string, body = 'draft') => ({
  name: 'execution.enqueue_once' as const,
  args: { name: 'Send', goal, steps: [{ type: 'action' as const, id: 'send', connector: 'gmail', action: 'message.send', params: { body } }] },
});

describe('pending command continuation', () => {
  beforeEach(() => clearPendingCommand('session', true));

  it('claims an exact plan only for its original request and prevents a concurrent duplicate claim', () => {
    const original = command('이번만 메일을 보내줘.');
    const token = rememberPendingCommand('session', original, 1_000)!;
    const inputRequests = [
      { id: 'recipient-1', label: '수신자', type: 'email' as const, required: true, stepId: 'send', capabilityId: 'gmail.message.send', parameterName: 'to' },
      { id: 'body-1', label: '본문', type: 'text' as const, required: true, stepId: 'send', capabilityId: 'gmail.message.send', parameterName: 'body' },
    ];
    bindPendingCommandInputRequests('session', token, inputRequests);

    expect(claimPendingCommand('session', '다른 메일을 보내줘.', ['recipient-1', 'body-1'], [], 1_001)).toEqual({ kind: 'mismatch' });
    expect(claimPendingCommand('session', '이번만 메일을 보내줘.', ['stale-form'], [], 1_001)).toEqual({ kind: 'mismatch' });
    const submitted = [
      { requestId: 'recipient-1', value: 'person@example.com' },
      { requestId: 'body-1', value: '안내 본문' },
    ];
    const claim = claimPendingCommand('session', '이번만 메일을 보내줘.', ['recipient-1', 'body-1'], submitted, 1_001);
    expect(claim).toMatchObject({ kind: 'claimed', command: original, inputValues: [
      { label: '수신자', value: 'person@example.com', stepId: 'send', capabilityId: 'gmail.message.send', parameterName: 'to' },
      { label: '본문', value: '안내 본문', stepId: 'send', capabilityId: 'gmail.message.send', parameterName: 'body' },
    ] });
    expect(claimPendingCommand('session', '다른 메일을 보내줘.', ['recipient-1', 'body-1'], submitted, 1_002)).toEqual({ kind: 'mismatch' });
    expect(claimPendingCommand('session', '이번만 메일을 보내줘.', ['recipient-1', 'body-1'], submitted, 1_002)).toEqual({ kind: 'in_progress' });
  });

  it('reopens only an input-incomplete plan and expires unclaimed plans', () => {
    const original = command('이번만 메일을 보내줘.');
    const firstToken = rememberPendingCommand('session', original, 1_000)!;
    const firstRequest = { id: 'recipient-1', label: '수신자', type: 'email' as const, required: true };
    bindPendingCommandInputRequests('session', firstToken, [firstRequest]);
    const claim = claimPendingCommand('session', '이번만 메일을 보내줘.', ['recipient-1'], [{ requestId: 'recipient-1', value: 'person@example.com' }], 1_001);
    if (claim.kind !== 'claimed') throw new Error('expected a plan claim');

    const updated = command('이번만 메일을 보내줘.', 'updated draft');
    const updatedToken = replaceClaimedPendingCommand('session', claim.token, updated, 1_002);
    expect(updatedToken).toBeDefined();
    bindPendingCommandInputRequests('session', updatedToken!, [{ ...firstRequest, id: 'recipient-2' }]);
    const updatedClaim = claimPendingCommand('session', '이번만 메일을 보내줘.', ['recipient-2'], [{ requestId: 'recipient-2', value: 'person@example.com' }], 1_003);
    expect(updatedClaim).toMatchObject({ kind: 'claimed', command: updated });
    if (updatedClaim.kind === 'claimed') finishClaimedPendingCommand('session', updatedClaim.token);
    clearPendingCommand('session', true);
    const expiryToken = rememberPendingCommand('session', original, 2_000)!;
    bindPendingCommandInputRequests('session', expiryToken, [{ ...firstRequest, id: 'recipient-3' }]);
    expect(claimPendingCommand('session', '이번만 메일을 보내줘.', ['recipient-3'], [{ requestId: 'recipient-3', value: 'person@example.com' }], 2_000 + 24 * 60 * 60 * 1_000)).toEqual({ kind: 'missing' });
  });

  it('preserves host-defined trigger and job field scopes for a recurring workflow', () => {
    const proposed = {
      name: 'job.propose' as const,
      args: { name: '주간 보고', goal: '매주 보고서 생성', trigger: { type: 'schedule' as const, schedule: '', timezone: '' }, steps: [], runOnceNow: false, allowExternalAuto: false },
    };
    const token = rememberPendingCommand('session', proposed, 1_000)!;
    bindPendingCommandInputRequests('session', token, [
      { id: 'schedule', label: '실행 일정 (Cron)', type: 'text', required: true, target: 'trigger', parameterName: 'schedule' },
      { id: 'channel', label: 'Slack 채널', type: 'slack_channel', required: true, target: 'job', parameterName: 'notify.channel' },
    ]);
    const claim = claimPendingCommand('session', '매주 보고서 생성', ['schedule', 'channel'], [
      { requestId: 'schedule', value: '0 9 * * 1' },
      { requestId: 'channel', value: 'C_OPS' },
    ], 1_001);
    expect(claim).toMatchObject({ kind: 'claimed', inputValues: [
      { target: 'trigger', parameterName: 'schedule', value: '0 9 * * 1' },
      { target: 'job', parameterName: 'notify.channel', value: 'C_OPS' },
    ] });
  });

  it('keeps a workflow.update continuation bound to the original chat request', () => {
    const request = '현재 workflow에 Gmail 발송 단계를 추가해줘.';
    const update = {
      name: 'workflow.update' as const,
      args: {
        workflowId: 'workflow-1',
        baseVersion: 3,
        operations: [{
          op: 'upsert_step' as const,
          step: {
            type: 'action' as const,
            id: 'jev_step_2',
            connector: 'gmail',
            action: 'message.send',
            params: {},
          },
        }],
      },
    };
    const token = rememberPendingCommand('session', update, 1_000, request)!;
    bindPendingCommandInputRequests('session', token, [
      { id: 'body', label: '본문', type: 'text', required: true, stepId: 'jev_step_2' },
    ]);

    expect(claimPendingCommand('session', request, ['body'], [
      { requestId: 'body', value: '본문 내용' },
    ], 1_001)).toMatchObject({
      kind: 'claimed', command: update,
      inputValues: [{ label: '본문', value: '본문 내용', stepId: 'jev_step_2' }],
    });
  });
});
