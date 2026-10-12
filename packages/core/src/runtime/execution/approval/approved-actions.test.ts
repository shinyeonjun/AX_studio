import { describe, expect, it, vi } from 'vitest';
import type { ConnectorContext } from '../../../connectors/types.js';
import type { WorkflowIR, Step } from '../../../workflow/schema.js';
import { approvalParamsHash } from '../../approval-snapshot.js';
import type { WorkflowExecutionHost } from '../contracts.js';
import { executeApprovedActions } from './approved-actions.js';

function sendStepWith(params: Record<string, unknown>): Extract<Step, { type: 'action' }> {
  return {
    type: 'action', id: 'send', connector: 'gmail', action: 'message.send',
    params, sideEffect: 'EXTERNAL_HIGH',
  } as never;
}

function workflowWith(step: Extract<Step, { type: 'action' }>): WorkflowIR {
  return {
    name: 'Approved send', goal: 'Send after approval', version: 1,
    trigger: { type: 'manual' }, inputs: [],
    steps: [step],
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
  } as never;
}

/** `params` is what the step will run with now; `paramsForSnapshot` is what the person approved. */
function setup(params: Record<string, unknown>, paramsForSnapshot = params) {
  const sendStep = sendStepWith(params);
  const ir = workflowWith(sendStep);
  const execute = vi.fn(async () => ({ ok: true as const, data: { messageId: 'm-1' } }));
  const connector = { execute } as never;
  const host = {
    connectors: { gmail: connector },
    config: {},
    notifyExecutionProgress: vi.fn(),
  } as unknown as WorkflowExecutionHost;
  const ctx = {
    log: vi.fn(), variables: {}, outputs: undefined, abortSignal: undefined,
  } as unknown as ConnectorContext;
  const approvalSnapshots = new Map([
    ['send', { actionRef: 'gmail.message.send', paramsHash: approvalParamsHash(paramsForSnapshot) }],
  ]);
  const stepResults: Record<string, unknown> = {};
  return {
    execute, host, ctx, approvalSnapshots, stepResults,
    run: () => executeApprovedActions({
      host, ir, approvedActions: [sendStep], remainingStepIds: new Set(), ctx,
      stepResults, approvalSnapshots,
    }),
  };
}

describe('executeApprovedActions', () => {
  it('executes the approved action once when the parameters match the approval', async () => {
    const params = { to: 'owner@example.invalid', body: 'approved body' };
    const { execute, run, stepResults } = setup(params);
    await run();
    expect(execute).toHaveBeenCalledTimes(1);
    expect(stepResults.send).toEqual({ messageId: 'm-1' });
  });

  it('refuses to send when the parameters changed after approval, and sends nothing', async () => {
    const approved = { to: 'owner@example.invalid', body: 'approved body' };
    const changed = { to: 'attacker@example.invalid', body: 'approved body' };
    const { execute, run, host } = setup(changed, approved);
    await expect(run()).rejects.toMatchObject({ code: 'approval_target_changed' });
    expect(execute).not.toHaveBeenCalled();
    expect(host.notifyExecutionProgress).toHaveBeenCalled();
  });

  it('skips an action that the surrounding sequence will run itself', async () => {
    const params = { to: 'owner@example.invalid', body: 'approved body' };
    const { execute, host, ctx, approvalSnapshots, stepResults } = setup(params);
    const sendStep = sendStepWith(params);
    await executeApprovedActions({
      host, ir: workflowWith(sendStep), approvedActions: [sendStep], remainingStepIds: new Set(['send']), ctx,
      stepResults, approvalSnapshots,
    });
    expect(execute).not.toHaveBeenCalled();
  });
});
