import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../harness.js';
import type { StructuredGenerateInput } from '../../model/provider.js';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';

describe('runAxCommandChat command loop', () => {
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
