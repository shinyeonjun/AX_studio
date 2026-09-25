import { describe, expect, it, vi } from 'vitest';
import { AgentHarness } from '../../harness.js';
import type { StructuredGenerateInput, TextGenerateInput } from '../../model/provider.js';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';

describe('runAxCommandChat provider compatibility', () => {
  it.each(['codex-cli', 'claude-cli', 'ollama-api'])(
    'uses $0 providers for prose without asking for structured command output',
    async (provider) => {
      const db = await createDatabaseAsync(':memory:');
      const service = new AxCommandService(new WorkflowStore(db));
      const execute = vi.spyOn(service, 'execute');
      const structuredCalls: StructuredGenerateInput<unknown>[] = [];
      const textCalls: TextGenerateInput[] = [];
      const decisionEngine: DecisionEngine = {
        evaluate: async () => ({ answers: {
          route: {
            type: 'choice', choice: 'answer',
            probabilities: { answer: 0.99, http_read: 0.01 }, confidence: 0.99,
          },
        } }),
      };
      const harness = new AgentHarness(scriptedModel(
        [], structuredCalls, provider, ['현재 연결 정보를 확인할 수 있도록 도와드릴게요.'], textCalls,
      ));

      const reply = await runAxCommandChat({
        harness,
        commandService: service,
        decisionEngine,
        messages: [],
        userMessage: '현재 연결 정보를 확인하려면 어떤 메뉴를 열면 돼?',
      });

      expect(reply).toBe('현재 연결 정보를 확인할 수 있도록 도와드릴게요.');
      expect(textCalls).toHaveLength(1);
      expect(structuredCalls).toHaveLength(0);
      expect(execute).not.toHaveBeenCalled();
      db.close();
    },
  );

  it('keeps a tool request reply-only when Jev is unavailable', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const structuredCalls: StructuredGenerateInput<unknown>[] = [];
    const textCalls: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel(
      [], structuredCalls, 'codex-cli', ['Jev 연결이 없어 메일을 보내지 않았습니다.'], textCalls,
    ));

    const reply = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: 'Alex에게 오늘 회의 자료를 보내줘.',
    });

    expect(reply).toContain('보내지 않았습니다');
    expect(textCalls[0]?.system).toContain('No AX command or connected-resource operation was executed');
    expect(structuredCalls).toHaveLength(0);
    expect(execute).not.toHaveBeenCalled();
    db.close();
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
    db.close();
  });
});
