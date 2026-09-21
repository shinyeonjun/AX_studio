import { describe, expect, it } from 'vitest';
import type { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import type { ListSlackChannels } from '../contract.js';
import type { ProposeResponse, ValidatedProposeInput } from './contracts.js';
import { resolveGenericJobTargets } from './target-selection.js';

function input(trigger: unknown, steps: unknown[]): ValidatedProposeInput {
  return {
    data: {
      name: '테스트 업무',
      goal: '테스트 업무를 실행한다',
      trigger,
      steps,
      runOnceNow: false,
      allowExternalAuto: false,
    },
    sessionId: 'session-1',
    genericWorkflow: true,
    path: '',
    channel: '',
    cron: '0 21 * * *',
    timezone: 'Asia/Seoul',
  } as ValidatedProposeInput;
}

function storeWithSlack(): WorkflowStore {
  return {
    getConnections: () => [{ connector: 'slack', connected: true, config: {} }],
  } as unknown as WorkflowStore;
}

const sendStep = (channel: string) => ({
  type: 'action',
  id: 'send',
  connector: 'slack',
  action: 'message.send',
  params: { channel, text: '테스트' },
});

describe('resolveGenericJobTargets', () => {
  it('does not infer a missing Slack trigger from an action destination', async () => {
    const result = await resolveGenericJobTargets({
      store: storeWithSlack(),
      input: input({ type: 'slack.new_message', channel: '' }, [sendStep('#alerts')]),
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; response: ProposeResponse }).response[0]).toBe('needs_input');
    expect((result as { ok: false; response: ProposeResponse }).response[2]?.[0]?.code)
      .toBe('job_trigger_target_required');
  });

  it('rejects an explicit Slack action channel missing from the connected inventory', async () => {
    const listSlackChannels: ListSlackChannels = async () => ({
      ok: true,
      data: { channels: [{ id: 'C1', name: 'alerts' }] },
    });
    const result = await resolveGenericJobTargets({
      store: storeWithSlack(),
      input: input({ type: 'slack.new_message', channel: 'C1' }, [sendStep('#missing')]),
      listSlackChannels,
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; response: ProposeResponse }).response[2]?.[0]?.code)
      .toBe('job_action_target_invalid');
  });

  it('accepts a trigger and action that resolve to the connected Slack channel', async () => {
    let calls = 0;
    const listSlackChannels: ListSlackChannels = async () => {
      calls += 1;
      return { ok: true, data: { channels: [{ id: 'C1', name: 'alerts' }] } };
    };
    const result = await resolveGenericJobTargets({
      store: storeWithSlack(),
      input: input({ type: 'slack.new_message', channel: 'C1' }, [sendStep('#alerts')]),
      listSlackChannels,
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
  });
});
