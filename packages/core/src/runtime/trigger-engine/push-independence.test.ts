import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../persistence/db.js';
import { WorkflowStore } from '../../persistence/workflow-store.js';

const transports = vi.hoisted(() => ({
  started: [] as Array<{ driver: string; override: unknown }>,
  stopped: [] as string[],
}));

function fakeDriver(connector: string, triggerType: string) {
  return {
    connector,
    triggerType,
    async refresh(_store: unknown, _emit: unknown, override: unknown) {
      // Slack keeps its token out of the store: without an override it cannot start.
      if (connector === 'slack' && !override) return undefined;
      transports.started.push({ driver: connector, override });
      return { stop: async () => { transports.stopped.push(connector); }, isRunning: () => true };
    },
    matchesTrigger: () => true,
    dedupeKey: () => 'k',
  };
}

vi.mock('../../connectors/packages/catalog.js', () => ({
  PUSH_TRIGGER_DRIVERS: [fakeDriver('slack', 'slack.new_message'), fakeDriver('webhook', 'webhook.inbound')],
}));

const { PushTransportManager } = await import('./push.js');

async function manager() {
  const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
  return new PushTransportManager(store, () => true, () => true);
}

describe('push transports are independent', () => {
  beforeEach(() => {
    transports.started.length = 0;
    transports.stopped.length = 0;
  });

  it('disconnecting Slack keeps the webhook server running', async () => {
    const push = await manager();
    await push.refreshSlackSocket({ token: 'xoxb', appToken: 'xapp' });
    await push.refresh(undefined, undefined, new Set(['webhook']));
    await push.refreshSlackSocket(null);
    expect(push.pushTransportActive('webhook.inbound')).toBe(true);
    expect(push.pushTransportActive('slack.new_message')).toBe(false);
    expect(push.pushTransportStatus('slack.new_message')).toEqual({ phase: 'disconnected' });
    expect(transports.stopped).toEqual(['slack']);
  });

  it('reconnecting the webhook keeps the Slack socket', async () => {
    const push = await manager();
    await push.refreshSlackSocket({ token: 'xoxb', appToken: 'xapp' });
    await push.refresh(undefined, undefined, new Set(['webhook']));
    await push.refresh(undefined, undefined, new Set(['webhook']));
    expect(push.pushTransportActive('slack.new_message')).toBe(true);
    expect(transports.stopped).toEqual(['webhook']);
  });

  it('a full refresh restarts Slack with the token it was given', async () => {
    const push = await manager();
    await push.refreshSlackSocket({ token: 'xoxb', appToken: 'xapp' });
    await push.refresh();
    expect(push.pushTransportActive('slack.new_message')).toBe(true);
    expect(transports.started.filter((entry) => entry.driver === 'slack').at(-1)?.override).toEqual({ token: 'xoxb', appToken: 'xapp' });
  });

  it('a disconnected Slack does not come back on a later full refresh', async () => {
    const push = await manager();
    await push.refreshSlackSocket({ token: 'xoxb', appToken: 'xapp' });
    await push.refreshSlackSocket(null);
    await push.refresh();
    expect(push.pushTransportActive('slack.new_message')).toBe(false);
  });

  it('stopping everything stops every transport', async () => {
    const push = await manager();
    await push.refreshSlackSocket({ token: 'xoxb', appToken: 'xapp' });
    await push.refresh(undefined, undefined, new Set(['webhook']));
    await push.refresh(null);
    expect(push.pushTransportActive('slack.new_message')).toBe(false);
    expect(push.pushTransportActive('webhook.inbound')).toBe(false);
  });
});
