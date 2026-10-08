import { describe, expect, it, vi } from 'vitest';
import type { DecisionEngine, DecisionEvaluationResult } from '../../../../../contracts/decision.js';
import type { TableArtifact } from '../../../../../contracts/artifacts/table.js';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { AgentHarness } from '../../../harness.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { parallelToolAnswersForTest, scriptedModel } from '../testing/fixtures.js';

describe('headers for columns the source names itself', () => {
  it('shows a mail list with Korean headers without asking the AI to name them', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'me@example.com' });
    const page = { messages: [
      { id: 'm1', threadId: 't1', from: '신연준 <a@example.com>', subject: '회의 변경 안내', date: 'Wed, 8 Oct 2026 09:00:00 +0900', snippet: '목요일 오후 3시' },
    ], limit: 10, truncated: false };
    const service = new AxCommandService(store, { readGateway: { execute: async () => ({
      tool: 'capabilities.invoke', ok: true, data: { capabilityId: 'gmail.messages.search', data: page, citations: [], untrusted: true },
    }) } });
    const choice = (value: string) => ({ type: 'choice' as const, choice: value, probabilities: { [value]: 0.99 }, confidence: 0.99 });
    const decisionEngine: DecisionEngine = {
      evaluate: async (request): Promise<DecisionEvaluationResult> => ({ answers: {
        ...parallelToolAnswersForTest(request, { needsNaturalLanguageAnswer: false, select: (candidate) => candidate.capabilityId === 'gmail.messages.search' }),
        ...(request.questions.route ? { route: choice('capability_read'), table_transform: choice('none') } : {}),
      } }),
    };
    const textSeen: unknown[] = [];
    let shown: TableArtifact | undefined;
    const remember = vi.fn();
    await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen as never)),
      commandService: service, decisionEngine, connectedConnectors: ['gmail'],
      readOperationHints: [{ key: 'op_0', capabilityId: 'gmail.messages.search', connector: 'gmail', label: '메일 검색', description: '메일 검색', params: {} }],
      messages: [], userMessage: '최근 메일 보여줘',
      columnLabels: { known: () => ({}), remember },
      onReadResult: (table) => { shown = table; },
    });
    expect(shown?.columns.map((column) => column.label)).toEqual(expect.arrayContaining(['보낸 사람', '제목', '받은 날짜', '미리보기']));
    expect(textSeen).toHaveLength(0);
    expect(remember).not.toHaveBeenCalled();
    db.close?.();
  });

  it('writes a summary without waiting for headers of new columns, then shows the table with them', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('rdb', true, {});
    const table = { id: 'orders', kind: 'table', sourceId: 'rdb', createdAt: '2026-10-08T00:00:00.000Z',
      columns: [{ name: 'order_total', type: 'number', nullable: false, inferred: false }],
      rows: [{ index: 0, values: { order_total: 12000 } }], truncated: false,
      completeness: { status: 'complete', hasMore: false } };
    const service = new AxCommandService(store, { readGateway: { execute: async () => ({
      tool: 'capabilities.invoke', ok: true, data: { capabilityId: 'rdb.query.read', data: table, citations: [], untrusted: true },
    }) } });
    const choice = (value: string) => ({ type: 'choice' as const, choice: value, probabilities: { [value]: 0.99 }, confidence: 0.99 });
    const decisionEngine: DecisionEngine = {
      evaluate: async (request): Promise<DecisionEvaluationResult> => ({ answers: {
        ...parallelToolAnswersForTest(request, { needsNaturalLanguageAnswer: true, select: (candidate) => candidate.capabilityId === 'rdb.query.read' }),
        ...(request.questions.route ? { route: choice('capability_read'), table_transform: choice('none') } : {}),
      } }),
    };
    let releaseLabels!: () => void;
    const labelsAsked = new Promise<void>((resolve) => { releaseLabels = resolve; });
    const order: string[] = [];
    const runText = vi.fn(async (request: { logContext?: string }) => {
      if (request.logContext === 'column_labels') {
        order.push('labels asked');
        await labelsAsked;
        order.push('labels answered');
        return { output: '{"order_total":"주문 금액"}' };
      }
      order.push('summary written');
      releaseLabels();
      return { output: '주문 금액은 12,000원입니다.' };
    });
    let shown: TableArtifact | undefined;
    const reply = await runAxCommandChat({
      harness: { runText, run: vi.fn(), providerName: 'test' } as never,
      commandService: service, decisionEngine, connectedConnectors: ['rdb'],
      readOperationHints: [{ key: 'op_0', capabilityId: 'rdb.query.read', connector: 'rdb', label: '주문 조회', description: '주문 조회', params: {} }],
      messages: [], userMessage: '주문 금액 알려줘',
      columnLabels: { known: () => ({}), remember: vi.fn() },
      onReadResult: (result) => { shown = result; },
    });
    expect(order).toEqual(['labels asked', 'summary written', 'labels answered']);
    expect(reply).toContain('12,000');
    expect(shown?.columns[0]?.label).toBe('주문 금액');
    db.close?.();
  });
});
