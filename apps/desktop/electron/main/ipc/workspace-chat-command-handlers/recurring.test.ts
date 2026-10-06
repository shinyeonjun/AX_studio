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

const { proposeRecurringFromExecution, proposeRecurringFromRead } = await import('./recurring.js');
const { rememberHostReadResult, clearHostChatStateForTests } = await import('./host-state.js');

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

describe('recurring draft from a read answer', () => {
  const table = { id: 'read-1', kind: 'table', columns: [{ name: 'title', type: 'string', nullable: false, inferred: true }], rows: [], truncated: false };
  const recipe = {
    kind: 'http_table' as const,
    params: { connectionId: 'default', method: 'GET', path: 'products' },
    rowsPath: 'products',
    expression: { op: 'filter' as const, input: { op: 'source' as const, sourceId: 'chat:read-result' }, where: { op: 'lt' as const, left: { ref: 'stock' }, right: { lit: 10 } } },
  };

  it('drafts the read the host remembers for the table still on screen, named after the request', async () => {
    clearHostChatStateForTests();
    const { store } = await setup();
    const chat = store.saveWorkspaceChat({ messages: [
      { role: 'user', content: '재고 10개 미만 상품만 표로 보여줘' },
      { role: 'assistant', content: '| title |', readResult: table as never },
      { role: 'user', content: `이 작업을 반복 업무로 만들기: ${weeklyMonday}` },
    ] });
    rememberHostReadResult(chat.id, table as never, { ...recipe, params: { ...recipe.params, connectionId: httpEndpointsFromConnections(store.getConnections())[0]!.id } });
    const reply = await proposeRecurringFromRead(chat.id, weeklyMonday);
    expect(reply.content).toContain('이 조회를 매주 월요일 오전 9:00에 반복하는 업무 초안입니다');
    const card = JSON.stringify(reply.presentations[0]);
    expect(card).toContain('재고 10개 미만 상품만 표로 보여줘');
    expect(card).toContain('표 정리 (2단계 결과 사용) · 부작용 없음(조회) · 조건: stock < 10');
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('drafts nothing once the transcript no longer shows that table', async () => {
    clearHostChatStateForTests();
    const { store } = await setup();
    const chat = store.saveWorkspaceChat({ messages: [
      { role: 'user', content: '표로 보여줘' },
      { role: 'assistant', content: '다른 표', readResult: { ...table, id: 'other' } as never },
    ] });
    rememberHostReadResult(chat.id, table as never, recipe);
    const reply = await proposeRecurringFromRead(chat.id, weeklyMonday);
    expect(reply.presentations).toEqual([]);
    expect(reply.content).toContain('조회 방법을 다시 확인할 수 없습니다');
  });
});
