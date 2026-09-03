import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

describe('workspace chat transcript persistence', () => {
  it('round-trips a valid workspace chat', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const saved = store.saveWorkspaceChat({
      workflowId: 'workflow-1',
      messages: [
        { role: 'user', content: '연결된 폴더를 확인해줘' },
        { role: 'assistant', content: '확인할게요.' },
      ],
    });

    expect(store.getWorkspaceChat(saved.id)).toMatchObject({
      id: saved.id,
      workflowId: 'workflow-1',
      messages: saved.messages,
    });
  });

  it('keeps session memo isolated from another chat and survives a later reload', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const first = store.saveWorkspaceChat({ messages: [] });
    const second = store.saveWorkspaceChat({ messages: [] });

    expect(store.updateWorkspaceChatMemo(first.id, {
      set: { audience: '운영팀', severity: 'critical' },
      remove: [],
    })).toEqual({ audience: '운영팀', severity: 'critical' });
    expect(store.getWorkspaceChatMemo(first.id)).toEqual({ audience: '운영팀', severity: 'critical' });
    expect(store.getWorkspaceChatMemo(second.id)).toEqual({});

    expect(store.updateWorkspaceChatMemo(first.id, {
      set: { severity: 'normal' },
      remove: ['audience'],
    })).toEqual({ severity: 'normal' });
    expect(store.getWorkspaceChatMemo(first.id)).toEqual({ severity: 'normal' });
  });

  it('round-trips optional host-rendered presentation metadata with the assistant message', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const saved = store.saveWorkspaceChat({
      messages: [{
        role: 'assistant',
        content: '처리 전에 확인해 주세요.',
        inputRequests: [{ id: 'channel', label: 'Slack 채널', type: 'slack_channel' }],
        presentations: [{
          title: '확인 필요',
          blocks: [{ type: 'decision', label: '대상', value: '연결된 폴더' }],
          inputs: [],
          actions: [{ id: 'continue', label: '진행', value: '진행해줘' }],
        }],
      }],
    });

    expect(store.getWorkspaceChat(saved.id)?.messages[0]).toMatchObject({
      inputRequests: [{ id: 'channel', type: 'slack_channel' }],
      presentations: [{ title: '확인 필요', actions: [{ id: 'continue', value: '진행해줘' }] }],
    });
  });
});
