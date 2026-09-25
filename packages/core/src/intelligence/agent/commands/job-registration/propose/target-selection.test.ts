import { describe, expect, it } from 'vitest';
import type { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import type { ListSlackChannels } from '../contract.js';
import type { ProposeResponse, ValidatedProposeInput } from './contracts.js';
import { resolveGenericJobTargets, resolveJobTargets } from './target-selection.js';

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
    expect((result as { ok: false; response: ProposeResponse }).response[2]?.[0]?.inputRequests)
      .toMatchObject([{ target: 'trigger', parameterName: 'channel', type: 'slack_channel' }]);
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
    expect((result as { ok: false; response: ProposeResponse }).response[2]?.[0]?.inputRequests)
      .toMatchObject([{
        stepId: 'send', capabilityId: 'slack.message.send', parameterName: 'channel',
      }]);
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

  it('returns a host-scoped Gmail account input when the connected account is unknown', async () => {
    const store = {
      getConnections: () => [{ connector: 'gmail', connected: true, config: {} }],
    } as unknown as WorkflowStore;
    const result = await resolveGenericJobTargets({
      store,
      input: input({ type: 'gmail.new_message', accountId: '' }, []),
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; response: ProposeResponse }).response[2]?.[0]?.inputRequests)
      .toMatchObject([{ target: 'trigger', parameterName: 'accountId', type: 'email' }]);
  });

  it('returns connected local folders as scoped stable options', async () => {
    const store = {
      getConnections: () => [{ connector: 'local_folder', connected: true, config: {
        folders: [
          { id: 'folder-1', label: '수신함', path: 'C:\\work\\inbox' },
          { id: 'folder-2', label: '완료함', path: 'C:\\work\\done' },
        ],
      } }],
    } as unknown as WorkflowStore;
    const result = await resolveGenericJobTargets({
      store,
      input: input({ type: 'local_folder.new_file', folderId: '' }, []),
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; response: ProposeResponse }).response[2]?.[0]?.inputRequests)
      .toMatchObject([{
        target: 'trigger', parameterName: 'folderId', type: 'folder',
        options: [
          { value: 'folder-1', label: '수신함' },
          { value: 'folder-2', label: '완료함' },
        ],
      }]);
  });

  it('binds legacy job target choices to only the supported job fields', async () => {
    const store = {
      getConnections: () => [
        { connector: 'http', connected: true, config: { endpoints: [
          { id: 'api-a', label: 'API A', baseUrl: 'https://a.example/' },
          { id: 'api-b', label: 'API B', baseUrl: 'https://b.example/' },
        ] } },
        { connector: 'slack', connected: true, config: {} },
      ],
    } as unknown as WorkflowStore;
    const result = await resolveJobTargets({ store, input: input(undefined, []) });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; response: ProposeResponse }).response[2]?.[0]?.inputRequests)
      .toMatchObject([
        { target: 'job', parameterName: 'fetch.connectionId' },
        { target: 'job', parameterName: 'notify.channel' },
      ]);
  });
});
