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
    const harness = new AgentHarness(scriptedModel([output], [], provider));

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
