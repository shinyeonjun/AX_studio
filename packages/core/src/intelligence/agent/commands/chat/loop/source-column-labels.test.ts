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
});
