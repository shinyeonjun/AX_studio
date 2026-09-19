import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { AgentHarness } from '../../harness.js';
import type { StructuredGenerateInput, TextGenerateInput } from '../../model/provider.js';
import { ArtifactStore } from '../../../../persistence/artifact-store.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { WorkspaceSourceService } from '../../../../persistence/workspace-source-service.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { scriptedModel } from './fixtures.js';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import { buildHttpResponseArtifact } from '../../../../contracts/artifacts/http-response.js';

describe('runAxCommandChat command loop', () => {
  it('answers trivial identity questions without Jev or an LLM round trip', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_should_not_run'); },
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '너의 모델은 뭐냐?',
    })).resolves.toContain('test-provider');
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(0);
  });

  it('uses Jev to execute a safe read and asks only the text model for prose', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice',
            choice: 'workflow_list',
            probabilities: { workflow_list: 0.97, answer: 0.03 },
            confidence: 0.97,
          },
          explicit_workflow_run: { type: 'boolean', probability: 0.01 },
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [
      '현재 저장된 workflow를 확인했습니다.',
    ], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '저장된 workflow 목록을 보여줘',
    })).resolves.toBe('현재 저장된 workflow를 확인했습니다.');

    expect(execute).toHaveBeenCalledWith(
      { name: 'workflow.list', args: {} },
      expect.objectContaining({ userMessage: '저장된 workflow 목록을 보여줘' }),
    );
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(1);
    expect(textSeen[0]?.messages?.at(-1)?.content).toContain('AX command result');
  });

  it('uses the text model directly when Jev selects a conversational answer', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice',
            choice: 'answer',
            probabilities: { answer: 0.97 },
            confidence: 0.97,
          },
          explicit_workflow_run: { type: 'boolean', probability: 0.01 },
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', [
      'workflow는 저장된 업무이고 일회 실행은 저장하지 않는 한 번의 실행입니다.',
    ], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: 'workflow와 일회 실행의 차이를 설명해줘',
    })).resolves.toContain('저장된 업무');
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('skips Jev for casual text so the response uses one text-model call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_should_not_run'); },
    };
    const harness = new AgentHarness(scriptedModel([], seen, 'test-provider', ['알겠어요.'], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '바보',
    })).resolves.toBe('알겠어요.');
    expect(seen).toHaveLength(0);
    expect(textSeen).toHaveLength(1);
  });

  it('does not call Jev for a conceptual API question', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_should_not_run'); },
    };
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', ['API는 외부 서비스와 통신하는 인터페이스입니다.'], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: 'API가 뭐야?',
    })).resolves.toContain('외부 서비스');
    expect(textSeen).toHaveLength(1);
  });

  it('returns a Jev-selected read failure without an LLM paraphrase', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db), {
      readGateway: {
        execute: async () => ({ tool: 'sources.list', ok: false, error: 'source_read_failed' }),
      },
    });
    const textSeen: TextGenerateInput[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice',
            choice: 'source_list',
            probabilities: { source_list: 0.98 },
            confidence: 0.98,
          },
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '연결된 자료 목록을 보여줘',
    })).resolves.toContain('source_read_failed');
    expect(textSeen).toHaveLength(0);
  });

  it('finishes a Jev-selected simple HTTP table without a second text-model call', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, {
      endpoints: [{ id: 'dummyjson', label: 'DummyJSON', baseUrl: 'https://dummyjson.com/', authType: 'none' }],
    });
    const response = buildHttpResponseArtifact({
      executionId: 'design-tool',
      url: 'https://dummyjson.com/products?limit=2',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ products: [
        { title: 'First', price: 1.99 },
        { title: 'Second', price: 2.99 },
      ], total: 2 }),
      truncated: false,
    });
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async (request) => {
          expect(request.args).toEqual({
            id: 'http.request',
            params: {
              method: 'GET',
              path: 'products?limit=2',
              connectionId: 'dummyjson',
            },
          });
          return {
            tool: 'capabilities.invoke',
            ok: true,
            data: { capabilityId: 'http.request', data: response, citations: [], untrusted: true },
          };
        },
      },
    });
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice',
            choice: 'http_read',
            probabilities: { http_read: 0.98, answer: 0.02 },
            confidence: 0.98,
          },
        },
      }),
    };
    const textSeen: TextGenerateInput[] = [];
    const harness = new AgentHarness(scriptedModel([], [], 'test-provider', [], textSeen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
      messages: [],
      userMessage: 'DummyJSON에서 GET products?limit=2 를 조회하고 표로 정리해줘.',
    })).resolves.toContain('| title | price |');
    expect(textSeen).toHaveLength(0);
  });

  it('falls back to the existing LLM planner when Jev is unavailable', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_unavailable'); },
    };
    const harness = new AgentHarness(scriptedModel([
      { kind: 'reply', message: '기존 경로로 답변했습니다.' },
    ], seen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '상태를 설명해줘',
    })).resolves.toBe('기존 경로로 답변했습니다.');
    expect(seen).toHaveLength(1);
  });

  it('does not execute a different mutation lifecycle after Jev delegation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const seen: StructuredGenerateInput<unknown>[] = [];
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice',
            choice: 'workflow_create',
            probabilities: { workflow_create: 0.98, answer: 0.02 },
            confidence: 0.98,
          },
          explicit_workflow_run: { type: 'boolean', probability: 0.01 },
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'workflow.delete', args: { workflowId: 'workflow-1', baseVersion: 1 } } },
    ], seen));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '새 workflow를 저장해줘',
    })).resolves.toContain('다른 명령이 제안되어 실행하지 않았습니다');
    expect(execute).not.toHaveBeenCalled();
    expect(seen[0]?.system).toContain('workflow.create');
    expect(seen[0]?.system).not.toContain('workflow.delete');
  });

  it('does not execute an LLM mutation when Jev rejects the user intent', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new AxCommandService(store);
    const execute = vi.spyOn(service, 'execute');
    const decisionEngine: DecisionEngine = {
      evaluate: async () => ({
        answers: {
          route: {
            type: 'choice',
            choice: 'workflow_create',
            probabilities: { workflow_create: 0.99, answer: 0.01 },
            confidence: 0.99,
          },
          explicit_workflow_run: { type: 'boolean', probability: 0.01 },
          intent_match: {
            type: 'choice',
            choice: 'reject',
            probabilities: { allow: 0.01, clarify: 0.03, reject: 0.96 },
            confidence: 0.95,
          },
          explicit_action: { type: 'boolean', probability: 0.1 },
        },
      }),
    };
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'workflow.create', args: { name: '금지된 업무', goal: '만들지 말아야 한다' } } },
    ], []));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: 'workflow는 만들지 말고 설명만 해줘',
    })).resolves.toContain('명확히 일치하지 않아 실행하지 않았습니다');
    expect(execute).not.toHaveBeenCalled();
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('fails closed before an LLM mutation when the configured Jev service is unavailable', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    let evaluations = 0;
    const decisionEngine: DecisionEngine = {
      evaluate: async () => {
        evaluations += 1;
        if (evaluations === 1) {
          return {
            answers: {
              route: {
                type: 'choice',
                choice: 'workflow_create',
                probabilities: { workflow_create: 0.99, answer: 0.01 },
                confidence: 0.99,
              },
              explicit_workflow_run: { type: 'boolean', probability: 0.01 },
            },
          };
        }
        throw new Error('jev_unavailable');
      },
    };
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'workflow.create', args: { name: '차단된 업무', goal: '생성 요청' } } },
    ], []));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '업무를 만들어줘',
    })).resolves.toContain('의미 판단 서비스를 확인할 수 없어');
    expect(evaluations).toBe(2);
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not let a context confirmation bypass the gate for another mutation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const execute = vi.spyOn(service, 'execute');
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => request.questions.route
        ? {
            answers: {
              route: { type: 'choice', choice: 'answer', probabilities: { answer: 0.99 }, confidence: 0.99 },
              explicit_workflow_run: { type: 'boolean', probability: 0.01 },
            },
          }
        : {
            answers: {
              intent_match: { type: 'choice', choice: 'reject', probabilities: { allow: 0.01, clarify: 0.03, reject: 0.96 }, confidence: 0.95 },
              explicit_action: { type: 'boolean', probability: 0.1 },
            },
          },
    };
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'workflow.create', args: { name: '우회 업무', goal: '확인 턴과 무관한 mutation' } } },
    ], []));

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      messages: [],
      userMessage: '이 기준을 기억해줘',
      allowContextUpdate: true,
    })).resolves.toContain('명확히 일치하지 않아 실행하지 않았습니다');
    expect(execute).not.toHaveBeenCalled();
  });

  it('recovers once when the provider reports a bounded structured-output error', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    let calls = 0;
    const harness = new AgentHarness({
      name: 'test-provider',
      async generateStructured<T>(): Promise<T> {
        calls += 1;
        if (calls === 1) {
          throw Object.assign(new Error('model_output_invalid'), {
            code: 'model_output_invalid', issues: [{ code: 'invalid_union', path: ['kind'] }],
          });
        }
        return { kind: 'reply', message: '재시도 후 완료했습니다.' } as T;
      },
      async generateText(): Promise<string> { throw new Error('text_generation_not_used'); },
    });

    await expect(runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: '상태를 알려줘',
    })).resolves.toBe('재시도 후 완료했습니다.');
    expect(calls).toBe(2);
  });

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
    const execute = vi.spyOn(service, 'execute');
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
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ userMessage: '새 workflow를 만들어줘' });
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

  it('starts a fresh report when the model echoes an id from an earlier execution result', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-chat-fresh-'));
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const now = new Date().toISOString();
    for (const source of [
      { id: 'template', fileName: 'template.pdf' },
      { id: 'example', fileName: 'example.pdf' },
    ]) {
      store.insertWorkspaceSource({
        ...source, sessionId: chat.id, artifactId: `artifact-${source.id}`,
        mimeType: 'application/pdf', status: 'ready', createdAt: now, updatedAt: now,
      });
    }
    const queued: Array<{ steps: Array<{ params: Record<string, unknown> }> }> = [];
    const service = new AxCommandService(store, {
      workspaceSources: new WorkspaceSourceService(
        store,
        new ArtifactStore(join(root, 'artifacts')),
        join(root, 'sessions'),
      ),
      enqueueOnce: (workflow) => {
        queued.push(workflow as typeof queued[number]);
        return { jobId: 'report-job' };
      },
    });
    const harness = new AgentHarness(scriptedModel([
      { kind: 'command', command: { name: 'report.generate', args: {
        goal: '다음 기간 보고서를 같은 기준으로 만들어줘',
        templateSourceId: 'template', exampleSourceId: 'example',
        resumeExecutionId: 'stale-previous-execution',
      } } },
      { kind: 'reply', message: '새 보고서 실행을 접수했습니다.' },
    ], []));

    await runAxCommandChat({
      harness,
      commandService: service,
      messages: [{ role: 'assistant', content: '이전 실행 결과: stale-previous-execution' }],
      userMessage: '자료에 있는 양식으로 다음 기간 보고서를 같은 기준과 형식으로 만들어줘',
      workspaceSessionId: chat.id,
    });

    expect(queued).toHaveLength(1);
    expect(queued[0]?.steps[0]?.params).not.toHaveProperty('resumeExecutionId');
  });
});
