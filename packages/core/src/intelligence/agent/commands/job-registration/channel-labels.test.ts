import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type { AxUiPresentation } from '../schema.js';
import type { ListSlackChannels, PendingJobDraft } from './contract.js';
import { proposeJob } from './propose.js';

async function setup() {
  const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
  store.setConnection('slack', true);
  const chat = store.saveWorkspaceChat({ messages: [] });
  return { store, chat, pending: new Map<string, PendingJobDraft>() };
}

const listing = (channels: Array<{ id: string; name: string; isPrivate?: boolean }>) =>
  vi.fn<ListSlackChannels>(async () => ({ ok: true, data: { channels } }));

function cardText(response: Awaited<ReturnType<typeof proposeJob>>): string {
  expect(response[0]).toBe('ok');
  return JSON.stringify((response[1] as { presentation: AxUiPresentation }).presentation);
}

function args(channel: string, trigger: unknown = { type: 'schedule', schedule: '0 9 * * 1', timezone: 'Asia/Seoul' }) {
  return {
    name: '재고 알림',
    goal: '재고가 적은 상품을 Slack으로 알린다',
    trigger,
    steps: [{ type: 'action', id: 'send', connector: 'slack', action: 'message.send', params: { channel, text: '재고 점검' } }],
  };
}

describe('Slack channels on the job confirmation card', () => {
  it('shows a picked channel id by its name', async () => {
    const { store, chat, pending } = await setup();
    const listSlackChannels = listing([{ id: 'C0BRC7MDE73', name: 'ax테스트' }, { id: 'C0OTHER0001', name: 'general' }]);
    const text = cardText(await proposeJob({ store, pending, workspaceSessionId: chat.id, args: args('C0BRC7MDE73'), listSlackChannels }));
    expect(text).toContain('대상: 채널 #ax테스트');
    expect(text).not.toContain('C0BRC7MDE73');
    // Target checks and the card share one listing.
    expect(listSlackChannels).toHaveBeenCalledTimes(1);
  });

  it('names the channel a Slack trigger listens to and marks private channels', async () => {
    const { store, chat, pending } = await setup();
    const listSlackChannels = listing([{ id: 'G0SECRET001', name: '임원', isPrivate: true }, { id: 'C0OPS000001', name: 'ops' }]);
    const text = cardText(await proposeJob({
      store, pending, workspaceSessionId: chat.id, listSlackChannels,
      args: args('C0OPS000001', { type: 'slack.new_message', channel: 'G0SECRET001' }),
    }));
    expect(text).toContain('Slack 새 메시지: 비공개 · #임원');
    expect(text).toContain('대상: 채널 #ops');
  });

  it('keeps a channel already written by name and does not list channels for it', async () => {
    const { store, chat, pending } = await setup();
    const listSlackChannels = listing([{ id: 'C0OPS000001', name: 'ops' }]);
    const text = cardText(await proposeJob({ store, pending, workspaceSessionId: chat.id, args: args('#ops'), listSlackChannels }));
    expect(text).toContain('대상: 채널 #ops');
  });

  it('falls back to the id when Slack cannot be listed', async () => {
    const { store, chat, pending } = await setup();
    const listSlackChannels = vi.fn<ListSlackChannels>(async () => { throw new Error('offline'); });
    const text = cardText(await proposeJob({ store, pending, workspaceSessionId: chat.id, args: args('C0BRC7MDE73'), listSlackChannels }));
    expect(text).toContain('대상: 채널 C0BRC7MDE73');
  });
});
