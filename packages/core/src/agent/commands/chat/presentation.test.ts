import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../harness.js';
import type { StructuredGenerateInput } from '../../model/provider.js';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';

describe('runAxCommandChat presentation and input', () => {
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
