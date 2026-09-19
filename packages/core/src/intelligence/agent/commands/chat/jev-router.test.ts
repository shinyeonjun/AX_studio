import { describe, expect, it } from 'vitest';
import type { DecisionEngine } from '../../../../contracts/decision.js';
import { routeChatWithJev } from './jev-router.js';

function engineFor(
  route: string,
  confidence = 0.95,
  explicitRunProbability = 0.01,
  onRequest?: (request: Parameters<DecisionEngine['evaluate']>[0]) => void,
): DecisionEngine {
  return {
    evaluate: async (request) => {
      onRequest?.(request);
      return {
        answers: {
          route: {
            type: 'choice',
            choice: route,
            probabilities: { [route]: confidence, answer: 1 - confidence },
            confidence,
          },
          explicit_workflow_run: {
            type: 'boolean',
            probability: explicitRunProbability,
          },
        },
      };
    },
  };
}

describe('routeChatWithJev', () => {
  it('returns a conversational reply route without selecting a command', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('answer', 0.96),
      userMessage: 'workflow와 일회 실행의 차이를 설명해줘',
    })).resolves.toEqual({ kind: 'reply', route: 'answer', confidence: 0.96 });
  });

  it('does not spend a boolean question on requests that cannot run a workflow', async () => {
    let questionIds: string[] = [];
    const result = await routeChatWithJev({
      decisionEngine: engineFor('answer', 0.96, 0.01, (request) => {
        questionIds = Object.keys(request.questions);
      }),
      userMessage: 'workflow가 무엇인지 설명해줘',
    });

    expect(result.kind).toBe('reply');
    expect(questionIds).toEqual(['route']);
  });

  it('maps a bounded semantic route to a fixed command', async () => {
    let request: Parameters<DecisionEngine['evaluate']>[0] | undefined;
    const result = await routeChatWithJev({
      decisionEngine: engineFor('discovery_search', 0.93, 0.01, (value) => { request = value; }),
      userMessage: '주문 데이터를 읽을 수 있는 테이블을 찾아줘',
      connectedConnectors: ['rdb', 'http'],
    });

    expect(result).toEqual({
      kind: 'command',
      route: 'discovery_search',
      confidence: 0.93,
      command: {
        name: 'discovery.search',
        args: { query: '주문 데이터를 읽을 수 있는 테이블을 찾아줘', limit: 10 },
      },
    });
    expect(request?.state).toMatchObject({
      context: { connected_connectors: ['rdb', 'http'] },
      policy: expect.stringContaining('untrusted data'),
    });
    expect(request?.questions.route).toMatchObject({ type: 'choice' });
  });

  it('maps an explicit GET path to http.request when one usable endpoint exists', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'DummyJSON 연결을 사용해서 다음 GET 경로를 호출해줘:\nproducts?limit=10&select=title,price',
      connectedConnectors: ['http'],
      httpEndpoints: [{ id: 'dummyjson', label: 'DummyJSON', usable: true }],
    })).resolves.toEqual({
      kind: 'command',
      route: 'http_read',
      confidence: 0.98,
      command: {
        name: 'capability.invoke',
        args: {
          id: 'http.request',
          params: {
            method: 'GET',
            path: 'products?limit=10&select=title,price',
            connectionId: 'dummyjson',
          },
        },
      },
    });
  });

  it('maps a Jev-selected catalog operation to a host-owned capability command', async () => {
    let questionIds: string[] = [];
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          questionIds = Object.keys(request.questions);
          return {
            answers: {
              route: {
                type: 'choice', choice: 'capability_read',
                probabilities: { capability_read: 0.97, answer: 0.03 }, confidence: 0.97,
              },
              operation: {
                type: 'choice', choice: 'op_0',
                probabilities: { op_0: 0.96, none: 0.04 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: '상품을 10개만 보여줘',
      connectedConnectors: ['openapi'],
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'openapi.catalog.listProducts',
        connector: 'openapi',
        label: '상품 목록',
        description: 'GET /products — 상품 목록',
        params: { query: { limit: 10 } },
      }],
    });

    expect(questionIds).toContain('operation');
    expect(result).toEqual({
      kind: 'command',
      route: 'capability_read',
      confidence: 0.97,
      command: {
        name: 'capability.invoke',
        args: {
          id: 'openapi.catalog.listProducts',
          params: { query: { limit: 10 } },
        },
      },
    });
  });

  it('separates operation selection from safe parameter filling', async () => {
    await expect(routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          answers: {
            route: {
              type: 'choice', choice: 'capability_read',
              probabilities: { capability_read: 0.97, answer: 0.03 }, confidence: 0.97,
            },
            operation: {
              type: 'choice', choice: 'op_0',
              probabilities: { op_0: 0.96, none: 0.04 }, confidence: 0.96,
            },
          },
        }),
      },
      userMessage: '주문 상세를 보여줘',
      connectedConnectors: ['openapi'],
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'openapi.orders.getOrder',
        connector: 'openapi',
        label: '주문 상세',
        description: 'GET /orders/{orderId} — 주문 상세',
        params: {},
        parameterHints: [{ path: 'pathParams.orderId', type: 'string', required: true }],
        missingParameterPaths: ['pathParams.orderId'],
      }],
    })).resolves.toEqual({
      kind: 'parameterized',
      route: 'capability_read',
      confidence: 0.97,
      plan: {
        capabilityId: 'openapi.orders.getOrder',
        fixedParams: {},
        allowedParameterPaths: ['pathParams.orderId'],
        requiredParameterPaths: ['pathParams.orderId'],
      },
    });
  });

  it('does not expose the catalog route when no read operation metadata exists', async () => {
    let routeCriteria: Record<string, unknown> | undefined;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          routeCriteria = (request.questions.route as { criteria: Record<string, unknown> }).criteria;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'answer',
                probabilities: { answer: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: '연결된 API가 뭐야?',
    });

    expect(result).toMatchObject({ kind: 'reply', route: 'answer' });
    expect(routeCriteria).not.toHaveProperty('capability_read');
  });

  it('does not add catalog operation selection to a conceptual API question', async () => {
    let questionIds: string[] = [];
    let routeCriteria: Record<string, unknown> | undefined;
    await expect(routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          questionIds = Object.keys(request.questions);
          routeCriteria = (request.questions.route as { criteria: Record<string, unknown> }).criteria;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'answer', probabilities: { answer: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: 'API가 뭐야?',
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'openapi.catalog.listProducts',
        connector: 'openapi',
        label: '상품 목록',
        description: 'GET /products — 상품 목록',
        params: {},
      }],
    })).resolves.toMatchObject({ kind: 'reply', route: 'answer' });

    expect(questionIds).toEqual(['route']);
    expect(routeCriteria).not.toHaveProperty('capability_read');
  });

  it('passes structured request features to Jev for natural-language data requests', async () => {
    let state: Record<string, unknown> | undefined;
    await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          state = request.state as Record<string, unknown>;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'answer', probabilities: { answer: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: '상품 5개 부탁해',
      readOperationHints: [{
        key: 'op_0',
        capabilityId: 'openapi.catalog.listProducts',
        connector: 'openapi',
        label: '상품 목록',
        description: 'GET /products — 상품 목록',
        params: {},
      }],
    });

    expect(state).toMatchObject({
      request_features: {
        data_reference: true,
        requested_limit: 5,
        requested_scope: 'collection',
      },
    });
  });

  it('fails closed when a bounded catalog has no relevant operation evidence', async () => {
    let routeCriteria: Record<string, unknown> | undefined;
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          routeCriteria = (request.questions.route as { criteria: Record<string, unknown> }).criteria;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'answer', probabilities: { answer: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: '재고를 보여줘',
      readOperationHints: Array.from({ length: 64 }, (_, index) => ({
        key: `op_${index}`,
        capabilityId: `openapi.orders.operation${index}`,
        connector: 'openapi' as const,
        label: '주문 목록',
        description: 'GET /orders — 주문 목록',
        params: {},
      })),
    });

    expect(result).toMatchObject({ kind: 'reply', route: 'answer' });
    expect(routeCriteria).not.toHaveProperty('capability_read');
  });

  it('keeps a relevant operation from the bounded catalog available', async () => {
    let operationCriteria: Record<string, unknown> | undefined;
    await routeChatWithJev({
      decisionEngine: {
        evaluate: async (request) => {
          operationCriteria = (request.questions.operation as { criteria: Record<string, unknown> }).criteria;
          return {
            answers: {
              route: {
                type: 'choice', choice: 'answer', probabilities: { answer: 0.96 }, confidence: 0.96,
              },
            },
          };
        },
      },
      userMessage: '재고를 보여줘',
      readOperationHints: [
        ...Array.from({ length: 63 }, (_, index) => ({
          key: `op_${index}`,
          capabilityId: `openapi.orders.operation${index}`,
          connector: 'openapi' as const,
          label: '주문 목록',
          description: 'GET /orders — 주문 목록',
          params: {},
        })),
        {
          key: 'op_63',
          capabilityId: 'openapi.inventory.listStock',
          connector: 'openapi' as const,
          label: '재고 목록',
          description: 'GET /inventory — 재고 목록',
          params: {},
        },
      ],
    });

    expect(operationCriteria).toHaveProperty('op_63');
    expect(Object.keys(operationCriteria ?? {})).toContain('none');
  });

  it('surfaces Jev usage and bounded question metadata for latency accounting', async () => {
    const result = await routeChatWithJev({
      decisionEngine: {
        evaluate: async () => ({
          model: 'jev-1.13',
          usage: { inputTokens: 120, outputTokens: 8 },
          answers: {
            route: {
              type: 'choice', choice: 'answer', probabilities: { answer: 0.96 }, confidence: 0.96,
            },
          },
        }),
      },
      userMessage: '상품 5개 부탁해',
      readOperationCatalogSize: 71,
      readOperationCatalogMayBeBounded: true,
      readOperationSelectionMode: 'lexical_relevance',
      readOperationLexicalMatchedOperationCount: 1,
      readOperationLexicalTopScore: 2,
    });

    expect(result).toMatchObject({
      kind: 'reply',
      telemetry: {
        model: 'jev-1.13',
        inputTokens: 120,
        outputTokens: 8,
        questionIds: ['route'],
        routeCandidateCount: 18,
        operationCandidateCount: 0,
        operationCatalogSize: 71,
        operationCatalogMayBeBounded: true,
        operationSelectionMode: 'lexical_relevance',
        operationLexicalMatchedOperationCount: 1,
        operationLexicalTopScore: 2,
      },
    });
  });

  it('does not guess a connection for an explicit GET when multiple endpoints match none', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'GET /api/v1/orders?status=paid 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: [
        { id: 'alpha', label: 'Alpha API', usable: true },
        { id: 'beta', label: 'Beta API', usable: true },
      ],
    })).resolves.toEqual({ kind: 'fallback', reason: 'missing_context' });
  });

  it('fails closed for write verbs, absolute URLs, and substring endpoint matches', async () => {
    const endpoints = [
      { id: 'api', label: 'Primary API', usable: true },
      { id: 'billing', label: 'Billing API', usable: true },
    ];
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'POST /orders 를 호출해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: endpoints,
    })).resolves.toEqual({ kind: 'fallback', reason: 'missing_context' });
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'GET https://example.com/orders 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: endpoints,
    })).resolves.toEqual({ kind: 'fallback', reason: 'missing_context' });
    await expect(routeChatWithJev({
      decisionEngine: engineFor('http_read', 0.98),
      userMessage: 'capitalize labels; GET /orders 를 조회해줘.',
      connectedConnectors: ['http'],
      httpEndpoints: endpoints,
    })).resolves.toEqual({ kind: 'fallback', reason: 'missing_context' });
  });

  it('falls back when a safe route is uncertain', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_list', 0.6),
      userMessage: '업무가 뭐였지?',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'uncertain' });
  });

  it('rejects a Jev choice outside the declared route set', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('__proto__', 0.99),
      userMessage: '무언가 해줘',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'unsupported' });
  });

  it('fills a bounded report command from two selected ready PDF sources', async () => {
    const sources = [
      { id: 'template', sessionId: 'chat-1', artifactId: 'a', fileName: 'blank.pdf', status: 'ready' as const, createdAt: '', updatedAt: '' },
      { id: 'example', sessionId: 'chat-1', artifactId: 'b', fileName: 'completed.pdf', status: 'ready' as const, createdAt: '', updatedAt: '' },
    ];
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        expect(request.questions).toHaveProperty('report_template_source');
        expect(request.questions).toHaveProperty('report_example_source');
        return {
          answers: {
            route: {
              type: 'choice', choice: 'report_generate',
              probabilities: { report_generate: 0.96, answer: 0.04 }, confidence: 0.96,
            },
            explicit_workflow_run: { type: 'boolean', probability: 0.01 },
            report_template_source: {
              type: 'choice', choice: 'template', probabilities: { template: 0.92, example: 0.08 }, confidence: 0.92,
            },
            report_example_source: {
              type: 'choice', choice: 'example', probabilities: { template: 0.06, example: 0.94 }, confidence: 0.94,
            },
          },
        };
      },
    };

    await expect(routeChatWithJev({
      decisionEngine,
      userMessage: '업로드한 양식과 완성 예시를 기준으로 이번 달 보고서를 만들어줘',
      currentWorkflowId: undefined,
      hasWorkspaceSession: true,
      workspaceSources: sources,
    })).resolves.toMatchObject({
      kind: 'command',
      route: 'report_generate',
      command: {
        name: 'report.generate',
        args: {
          goal: '업로드한 양식과 완성 예시를 기준으로 이번 달 보고서를 만들어줘',
          templateSourceId: 'template',
          exampleSourceId: 'example',
        },
      },
    });
  });

  it('does not ask Jev to choose report sources when fewer than two ready PDFs exist', async () => {
    const decisionEngine: DecisionEngine = {
      evaluate: async (request) => {
        expect(request.questions).not.toHaveProperty('report_template_source');
        expect(request.questions).not.toHaveProperty('report_example_source');
        return {
          answers: {
            route: {
              type: 'choice', choice: 'workflow_list',
              probabilities: { workflow_list: 0.95, answer: 0.05 }, confidence: 0.95,
            },
            explicit_workflow_run: { type: 'boolean', probability: 0.01 },
          },
        };
      },
    };

    await expect(routeChatWithJev({
      decisionEngine,
      userMessage: '저장된 업무를 보여줘',
      workspaceSources: [{
        id: 'only-pdf', sessionId: 'chat-1', artifactId: 'a', fileName: 'only.pdf',
        status: 'ready', createdAt: '', updatedAt: '',
      }],
    })).resolves.toMatchObject({
      kind: 'command',
      route: 'workflow_list',
      command: { name: 'workflow.list', args: {} },
    });
  });

  it('does not invent a workflow id for inspection', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_inspect'),
      userMessage: '현재 업무를 자세히 확인해줘',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'missing_context' });
  });

  it('delegates a workflow creation lifecycle while keeping payload generation typed', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_create', 0.95),
      userMessage: '매일 주문을 확인하는 workflow를 저장해줘',
    });

    expect(result).toMatchObject({ kind: 'delegate', route: 'workflow_create', confidence: 0.95 });
    if (result.kind !== 'delegate') throw new Error('expected delegated route');
    expect(result.allowedCommandNames).toContain('workflow.create');
    expect(result.allowedCommandNames).not.toContain('workflow.delete');
  });

  it('requires the current workflow before delegating update or delete', async () => {
    await expect(routeChatWithJev({
      decisionEngine: engineFor('workflow_update'),
      userMessage: '현재 workflow의 이름을 바꿔줘',
    })).resolves.toEqual({ kind: 'fallback', reason: 'missing_context' });
    await expect(routeChatWithJev({
      decisionEngine: engineFor('workflow_delete'),
      userMessage: '현재 workflow를 삭제해줘',
    })).resolves.toEqual({ kind: 'fallback', reason: 'missing_context' });
  });

  it('requires semantic and deterministic confirmation before a workflow run', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_run', 0.99, 0.99),
      currentWorkflowId: 'workflow-1',
      userMessage: 'workflow를 실행하지 말고 검토만 해줘',
    });

    expect(result).toEqual({ kind: 'fallback', reason: 'uncertain' });
  });

  it('returns the selected workflow run only after all execution gates pass', async () => {
    const result = await routeChatWithJev({
      decisionEngine: engineFor('workflow_run', 0.99, 0.99),
      currentWorkflowId: 'workflow-1',
      userMessage: '현재 workflow를 지금 실행해줘',
    });

    expect(result).toEqual({
      kind: 'command',
      route: 'workflow_run',
      confidence: 0.99,
      command: { name: 'workflow.run', args: { workflowId: 'workflow-1' } },
    });
  });

  it('keeps the normal LLM path available when Jev is unavailable', async () => {
    const engine: DecisionEngine = {
      evaluate: async () => { throw new Error('jev_unavailable'); },
    };

    await expect(routeChatWithJev({
      decisionEngine: engine,
      userMessage: 'workflow를 만들어줘',
    })).resolves.toEqual({ kind: 'fallback', reason: 'service_error' });
  });
});
