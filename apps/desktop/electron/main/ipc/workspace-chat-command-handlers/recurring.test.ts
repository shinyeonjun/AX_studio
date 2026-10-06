import { describe, expect, it, vi } from 'vitest';
import {
  AxCommandService,
  createDatabaseAsync,
  encodeScheduleInputValue,
  httpEndpointsFromConnections,
  validateWorkflowIR,
  WorkflowStore,
} from '@ax-studio/core';

const mocks = vi.hoisted(() => ({ getCore: vi.fn() }));
vi.mock('electron', () => ({ app: { isPackaged: true }, ipcMain: { handle: vi.fn(), removeHandler: vi.fn() } }));
vi.mock('../../app-window.js', () => ({ getMainWindow: () => undefined, isTrustedRendererUrl: () => true }));
vi.mock('../../core-instance.js', () => ({ getCore: mocks.getCore }));

const { proposeRecurringFromExecution } = await import('./recurring.js');

const weeklyMonday = encodeScheduleInputValue({
  kind: 'recurrence', freq: 'weekly', interval: 1, byWeekday: [{ day: 'MO' }], times: [{ hour: 9, minute: 0 }],
  anchor: '2026-10-05', timezone: 'Asia/Seoul',
});

async function setup() {
  const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
  store.setConnection('http', true, { baseUrl: 'https://dummyjson.com/' });
  const chat = store.saveWorkspaceChat({ messages: [] });
  const commandService = new AxCommandService(store, {});
  mocks.getCore.mockReturnValue({ store, commandService });
  const connectionId = httpEndpointsFromConnections(store.getConnections())[0]!.id;
  const ir = validateWorkflowIR({
    version: 1, name: '상품 목록 조회', goal: 'DummyJSON 상품 목록을 읽어줘', trigger: { type: 'manual' },
    steps: [{ type: 'action', id: 'fetch', connector: 'http', action: 'request', params: { connectionId, method: 'GET', path: 'products' }, sideEffect: 'NONE' }],
  });
  if (!ir.ok) throw new Error(ir.error);
  const executionId = store.createExecution({ ephemeral: true, irJson: JSON.stringify(ir.value), workspaceSessionId: chat.id });
  store.finishExecution(executionId, 'success');
  return { store, chat, executionId };
}

describe('recurring draft from a one-off run', () => {
  it('answers with the confirmation card and saves nothing', async () => {
    const { store, chat, executionId } = await setup();
    const reply = await proposeRecurringFromExecution(chat.id, executionId, weeklyMonday);
    expect(reply.content).toContain('매주 월요일 오전 9:00');
    expect(reply.presentations).toHaveLength(1);
    expect(JSON.stringify(reply.presentations[0])).toContain('저장하고 켜기');
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('explains instead of drafting when the run belongs elsewhere', async () => {
    const { store, executionId } = await setup();
    const other = store.saveWorkspaceChat({ messages: [] });
    const reply = await proposeRecurringFromExecution(other.id, executionId, weeklyMonday);
    expect(reply.presentations).toEqual([]);
    expect(reply.content).toContain('찾지 못했습니다');
  });

  it('rejects malformed input before touching the store', async () => {
    await setup();
    await expect(proposeRecurringFromExecution('../x', 'exec', weeklyMonday)).rejects.toThrow();
    await expect(proposeRecurringFromExecution('session', 'exec id', weeklyMonday)).rejects.toThrow();
    await expect(proposeRecurringFromExecution('session', 'exec', '')).rejects.toThrow();
  });
});
