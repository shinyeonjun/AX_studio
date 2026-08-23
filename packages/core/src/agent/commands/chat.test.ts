import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../harness.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../model/provider.js';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { runAxCommandChat } from './chat.js';
import { AxCommandService } from './service.js';

function scriptedModel(outputs: unknown[], seen: StructuredGenerateInput<unknown>[]): ModelProvider {
  return {
    name: 'test-provider',
    async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
      seen.push(input as StructuredGenerateInput<unknown>);
      const next = outputs.shift();
      if (next === undefined) throw new Error('test_model_script_exhausted');
      return next as T;
    },
    async generateText(_input: TextGenerateInput): Promise<string> {
      throw new Error('text_generation_not_used');
    },
  };
}

describe('runAxCommandChat', () => {
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

  it('returns typed input requests separately from the assistant transcript', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const inputRequests: Array<{ id: string; type: string; label: string }> = [];
    const harness = new AgentHarness(
      scriptedModel(
        [
          { kind: 'command', command: { name: 'workflow.inspect', args: {} } },
          { kind: 'reply', message: '워크플로우를 확인하려면 대상이 필요합니다.' },
        ],
        seen,
      ),
    );

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: '업무를 확인해줘',
      onInputRequests: (requests) => inputRequests.push(...requests),
    });

    expect(reply).toBe('워크플로우를 확인하려면 대상이 필요합니다.');
    expect(inputRequests).toEqual([
      expect.objectContaining({ type: 'text', label: '워크플로우' }),
    ]);
    expect(reply).not.toContain('missing_argument');
    expect(seen[1]?.messages?.at(-1)?.content).toContain('missing_argument');
  });

  it('keeps ui.present internal and returns its validated card separately', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const presentations: Array<{ title: string }> = [];
    const harness = new AgentHarness(
      scriptedModel(
        [
          {
            kind: 'command',
            command: {
              name: 'ui.present',
              args: {
                title: '실행 방식을 선택해 주세요',
                actions: [{ id: 'once', label: '한 번 실행', value: '한 번 실행해줘' }],
              },
            },
          },
          { kind: 'reply', message: '원하는 실행 방식을 선택해 주세요.' },
        ],
        seen,
      ),
    );

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: 'PDF를 확인해서 알려줘',
      onPresentation: (presentation) => presentations.push({ title: presentation.title }),
    });

    expect(reply).toBe('원하는 실행 방식을 선택해 주세요.');
    expect(reply).not.toContain('ui.present');
    expect(presentations).toEqual([{ title: '실행 방식을 선택해 주세요' }]);
    expect(seen[1]?.messages?.at(-1)?.content).toContain('AX command result');
  });
});
