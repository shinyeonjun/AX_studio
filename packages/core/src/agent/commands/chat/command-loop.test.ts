import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../harness.js';
import type { StructuredGenerateInput } from '../../model/provider.js';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';

describe('runAxCommandChat command loop', () => {
  it('does not replace a natural multi-source report request with the max-round fallback', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [
        { id: 'orders', label: '주문 API', baseUrl: 'http://127.0.0.1:43120/', authType: 'apiKey', authHeader: 'X-API-Key' },
      ],
    });
    const service = new AxCommandService(store);
    const seen: StructuredGenerateInput<unknown>[] = [];
    const readCommands = [
      'resource.list',
      'http.list',
      'command.list',
      'workflow.list',
      'resource.list',
      'http.list',
      'command.list',
      'workflow.list',
    ] as const;
    const harness = new AgentHarness(
      scriptedModel([
        ...readCommands.map((name) => ({ kind: 'command', command: { name, args: {} } })),
        { kind: 'reply', message: '2026년 9월 보고서 작성을 완료했습니다.' },
      ], seen),
    );

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: '자료에 2026년 8월에 작성했던 고객 매출 및 운영 리스크 보고서야 연결된 주문 API와 고객/계약 DB를 사용해서 2026년 9월 보고서도 같은 기준과 같은 형식으로 만들어줘, 실제 데이터 변경이나 외부 전송은 하지 마. 양식은 자료에있는 템플릿 이용하면 돼',
      connectedConnectors: ['http', 'rdb'],
    });

    expect(reply).toBe('2026년 9월 보고서 작성을 완료했습니다.');
    expect(reply).not.toContain('단계가 너무 많아졌습니다');
    expect(seen).toHaveLength(readCommands.length + 1);
  });

  it('executes a model command through AxCommandService and returns only the final reply', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new AxCommandService(store);
    const seen: StructuredGenerateInput<unknown>[] = [];
    const commandResults: string[] = [];
    const harness = new AgentHarness(
      scriptedModel(
        [
          {
            kind: 'command',
            command: {
              name: 'workflow.create',
              args: { name: '명령 채팅', goal: '명령 루프로 생성한다' },
            },
          },
          { kind: 'reply', message: 'workflow를 생성했습니다.' },
        ],
        seen,
      ),
    );

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: '새 workflow를 만들어줘',
      connectedConnectors: ['local_folder'],
      currentWorkflowId: 'workflow-1',
      onCommandResult: (result) => commandResults.push(result.command),
    });

    expect(reply).toBe('workflow를 생성했습니다.');
    expect(store.listWorkflows()).toHaveLength(1);
    expect(commandResults).toEqual(['workflow.create']);
    expect(seen).toHaveLength(2);
    expect(seen[0]?.system).toContain('AX command protocol');
    expect(seen[0]?.system).toContain('workflow.create');
    expect(seen[0]?.system).toContain('workflow-1');
    expect(seen[0]?.system).toContain('lifecycle');
    expect(seen[0]?.system).toContain('capability ID');
    expect(seen[0]?.system).toContain('rdb.schema.describe');
    expect(seen[1]?.messages?.at(-1)?.content).toContain('AX command result');
  });

  it('keeps command results inside the model loop instead of exposing protocol JSON', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const harness = new AgentHarness(
      scriptedModel(
        [
          { kind: 'command', command: { name: 'workflow.inspect', args: {} } },
          { kind: 'reply', message: 'workflow 식별자가 필요합니다.' },
        ],
        seen,
      ),
    );

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: 'workflow를 확인해줘',
    });

    expect(reply).toBe('workflow 식별자가 필요합니다.');
    expect(reply).not.toContain('missing_argument');
    expect(seen[1]?.messages?.at(-1)?.content).toContain('missing_argument');
  });
});
