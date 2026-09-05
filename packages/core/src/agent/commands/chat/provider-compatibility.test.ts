import { describe, expect, it, vi } from 'vitest';
import { AgentHarness } from '../../harness.js';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';

describe('runAxCommandChat provider compatibility', () => {
  it.each([
    {
      provider: 'codex-cli',
      output: { kind: 'command', commandName: 'rdb.schema.describe', argsJson: '{}', message: '' },
    },
    {
      provider: 'claude-cli',
      output: { kind: 'command', command: { name: 'rdb.schema.describe', args: {} }, message: '' },
    },
    {
      provider: 'ollama-api',
      output: { kind: 'command', command: { name: 'rdb.schema.describe', args: {} }, message: '' },
    },
  ])('turns an unsupported $provider command into a bounded chat result', async ({ provider, output }) => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const harness = new AgentHarness(scriptedModel([output, output], seen, provider));

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: 'PostgreSQL 스키마를 확인해줘',
    });

    expect(reply).toMatch(/명령|command/i);
    expect(reply).not.toContain('invalid_enum_value');
    expect(reply).not.toContain('Expected');
    expect(execute).not.toHaveBeenCalled();
    expect(seen).toHaveLength(2);
  });

  it.each([
    ['codex-cli', { kind: 'command', commandName: 'rdb.schema.describe', argsJson: '{}', message: '' }],
    ['claude-cli', { kind: 'command', command: { name: 'rdb.schema.describe', args: {} }, message: '' }],
    ['ollama-api', { kind: 'command', command: { name: 'rdb.schema.describe', args: {} }, message: '' }],
  ] as const)('recovers from an unsupported capability id without asking the user to resend the request for %s', async (provider, invalidOutput) => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const harness = new AgentHarness(
      scriptedModel([
        invalidOutput,
        { kind: 'reply', message: '2026년 9월 보고서 생성을 준비했습니다.' },
      ], seen, provider),
    );

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: '자료에 2026년 8월에 작성했던 고객 매출 및 운영 리스크 보고서야 연결된 주문 API와 고객/계약 DB를 사용해서 2026년 9월 보고서도 같은 기준과 같은 형식으로 만들어줘, 실제 데이터 변경이나 외부 전송은 하지 마. 양식은 자료에있는 템플릿 이용하면 돼',
      connectedConnectors: ['http', 'rdb'],
    });

    expect(reply).toBe('2026년 9월 보고서 생성을 준비했습니다.');
    expect(reply).not.toContain('지원되지 않는 명령 형식');
    expect(seen).toHaveLength(2);
    expect(seen[1]?.messages?.at(-1)?.content).toContain('명령은 실행되지 않았습니다');
  });

  it('does not commit a job when the request is already aborted', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const controller = new AbortController();
    controller.abort();

    await expect(runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], [])),
      commandService: service,
      messages: [],
      userMessage: '확인',
      allowJobCommit: true,
      abortSignal: controller.signal,
    })).rejects.toThrow('요청이 취소되었습니다.');
    expect(execute).not.toHaveBeenCalled();
  });
});
