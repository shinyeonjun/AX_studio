import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { AxCommandService } from '../service.js';
import type { AxUiPresentation } from '../schema.js';
import { commandChatContext } from './fixtures.js';

const proposal = {
  name: '반품 주문 확인',
  goal: '반품된 주문을 매일 확인한다',
  trigger: { type: 'schedule', recurrence: {
    kind: 'recurrence', freq: 'daily', interval: 1, times: [{ hour: 9, minute: 0 }], anchor: '2026-10-01', timezone: 'Asia/Seoul',
  }, timezone: 'Asia/Seoul' },
  steps: [{ type: 'action', id: 'read', connector: 'http', action: 'request', params: { method: 'GET', path: 'orders' } }],
  runOnceNow: false,
};

let root: string;
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The app as it starts: a fresh process over the same database file. */
async function open(path: string) {
  const db = await createDatabaseAsync(path);
  const store = new WorkflowStore(db);
  return { db, store, service: new AxCommandService(store) };
}

function tokenOf(data: unknown): string {
  const id = (data as { presentation: AxUiPresentation }).presentation.actions.find((action) => action.purpose === 'confirm_job')?.id;
  return id!.split(':')[1]!;
}

describe('a job card left in the chat across an app restart', () => {
  it('still saves the job it showed after the app is restarted, once', async () => {
    root = mkdtempSync(join(tmpdir(), 'ax-job-restart-'));
    const path = join(root, 'ax.db');
    const before = await open(path);
    before.store.setConnection('http', true, { baseUrl: 'https://shop.example.com/' });
    const chat = before.store.saveWorkspaceChat({ messages: [] });
    const proposed = await before.service.execute({ name: 'job.propose', args: proposal }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(proposed.status, JSON.stringify(proposed.issues)).toBe('ok');
    const token = tokenOf(proposed.data);
    before.db.close?.();

    const after = await open(path);
    const confirm = { ...commandChatContext, workspaceSessionId: chat.id, allowJobCommit: true, jobCommitConfirmationToken: token };
    const committed = await after.service.execute({ name: 'job.commit', args: {} }, confirm);
    expect(committed.status, JSON.stringify(committed.issues)).toBe('ok');
    expect(after.store.listWorkflows().map((workflow) => [workflow.name, workflow.active])).toEqual([['반품 주문 확인', true]]);

    // The card is spent: pressing it again saves nothing more.
    expect((await after.service.execute({ name: 'job.commit', args: {} }, confirm)).status).not.toBe('ok');
    expect(after.store.listWorkflows()).toHaveLength(1);
    after.db.close?.();
  });

  it('refuses a token that is not the card shown, and forgets drafts of a deleted chat', async () => {
    root = mkdtempSync(join(tmpdir(), 'ax-job-restart-'));
    const { db, store, service } = await open(join(root, 'ax.db'));
    store.setConnection('http', true, { baseUrl: 'https://shop.example.com/' });
    const chat = store.saveWorkspaceChat({ messages: [] });
    await service.execute({ name: 'job.propose', args: proposal }, { ...commandChatContext, workspaceSessionId: chat.id });

    const forged = await service.execute({ name: 'job.commit', args: {} }, {
      ...commandChatContext, workspaceSessionId: chat.id, allowJobCommit: true, jobCommitConfirmationToken: 'not-the-card',
    });
    expect(forged.status).not.toBe('ok');
    expect(store.listWorkflows()).toHaveLength(0);

    store.deleteWorkspaceChat(chat.id);
    expect(store.chatHostState('pending_job').has(chat.id)).toBe(false);
    db.close?.();
  });

  it('keeps the newest drafts when many chats leave one, instead of refusing new ones', async () => {
    root = mkdtempSync(join(tmpdir(), 'ax-job-restart-'));
    const { db, store } = await open(join(root, 'ax.db'));
    const drafts = store.chatHostState<{ n: number }>('pending_job', 3);
    for (let n = 1; n <= 5; n += 1) drafts.set(`chat-${n}`, { n });
    expect([...drafts].map(([chatId]) => chatId)).toEqual(['chat-3', 'chat-4', 'chat-5']);
    db.close?.();
  });
});
