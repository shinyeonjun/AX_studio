/**
 * North Star product QA — maps manual checklist scenarios to automated regression.
 * See docs/qa/north-star-scenarios.md
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHarness } from '../agent/harness.js';
import type { ModelProvider, StructuredGenerateInput } from '../agent/model/provider.js';
import { z } from 'zod';
import { clearDynamicCatalogForTests } from '../catalog/dynamic-catalog.js';
import { buildDesignToolContext, executeDesignTool, executeDesignToolCalls } from '../design-tools/index.js';
import { MockSlackConnector } from '../modules/mocks/slack.js';
import { createTestConnectors, mockSlack } from '../modules/test-connectors.js';
import { createDatabaseAsync } from '../store/db.js';
import { WorkflowStore } from '../store/workflow-store.js';
import { WorkflowRuntime } from '../runtime/engine.js';
import { runSavedWorkflowById } from '../runtime/manual-workflow-run.js';
import { parseExecutionLog, hasExecutionLogCode } from '../runtime/execution-log.js';
import { applySnippetPolicy, MAX_CLOUD_SNIPPET_CHARS } from '../retrieval/snippet-policy.js';
import { ingestOpenApiSpec } from '../openapi/ingest.js';
import { requiresApproval } from '../workflow/approval.js';
import type { WorkflowIR } from '../workflow/schema.js';
import { setDocumentEngineClient } from '../document-engine/engine-client.js';

class CloudSpyProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  sawSecret = false;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const blob = `${input.system}\n${input.user ?? ''}`;
    this.sawSecret = blob.includes('secret-pdf-body');
    return input.schema.parse({ ok: true });
  }

  async generateText(): Promise<string> {
    return '';
  }
}

function slackNotifyWorkflow(overrides: Partial<WorkflowIR> = {}): WorkflowIR {
  return {
    name: '알림',
    goal: 'Slack 알림',
    version: 1,
    steps: [
      {
        type: 'action',
        id: 'notify',
        connector: 'slack',
        action: 'message.send',
        params: { channel: '#ops', text: 'hello' },
        sideEffect: 'EXTERNAL',
      },
    ],
    permissions: {},
    approval: [],
    allowExternalAuto: false,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
    ...overrides,
  };
}

describe('North Star QA', () => {
  afterEach(() => {
    clearDynamicCatalogForTests();
    setDocumentEngineClient(null);
  });

  describe('1. plain chat knowledge (Slack / PDF / search)', () => {
    it('reads Slack via capabilities.invoke with citations', async () => {
      const slack = new MockSlackConnector();
      const ctx = buildDesignToolContext([{ connector: 'slack', connected: true }], ['slack'], undefined, {
        interactionMode: 'plain_chat',
        allowUntrustedData: true,
        connectors: { slack },
      });
      const result = await executeDesignTool(
        { tool: 'capabilities.invoke', args: { id: 'slack.messages.search', params: { query: 'deploy' } } },
        ctx,
      );
      expect(result.ok).toBe(true);
      const envelope = result.data as { citations: unknown[] };
      expect(envelope.citations.length).toBeGreaterThan(0);
    });

    it('blocks Slack send in plain chat', async () => {
      const slack = new MockSlackConnector();
      const ctx = buildDesignToolContext([{ connector: 'slack', connected: true }], ['slack'], undefined, {
        interactionMode: 'plain_chat',
        connectors: { slack },
      });
      const result = await executeDesignTool(
        { tool: 'capabilities.invoke', args: { id: 'slack.message.send', params: { channel: '#x', text: 'x' } } },
        ctx,
      );
      expect(result.ok).toBe(false);
    });

    it('blocks PDF body for cloud callers without local-data consent', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'ax-qa-pdf-'));
      const pdfPath = join(dir, 'doc.pdf');
      writeFileSync(pdfPath, 'pdf');
      setDocumentEngineClient({
        ping: async () => true,
        ingest: async () => ({
          documentId: 'd1',
          artifactPath: '/a',
          engine: 'test',
          summary: { pageCount: 1, chunkCount: 1, tableCount: 0, imageCount: 0, visualPageCount: 0, visualPages: [], engine: 'test' },
          text: 'secret-pdf-body',
        }),
        pdfToHtml: async () => { throw new Error('unused'); },
        getChunk: async () => { throw new Error('unused'); },
        getPage: async () => { throw new Error('unused'); },
        search: async () => { throw new Error('unused'); },
      });
      const ctx = buildDesignToolContext(
        [{ connector: 'local_folder', connected: true, config: { folders: [{ id: 'f1', label: 'Inbox', path: dir }] } }],
        ['local_folder'],
        undefined,
        { interactionMode: 'plain_chat', allowUntrustedData: false },
      );
      const result = await executeDesignTool(
        { tool: 'sources.file.read', args: { folderId: 'f1', path: pdfPath } },
        ctx,
      );
      expect(result.ok).toBe(false);
      expect(result.error).toBe('source_content_requires_local_ai');
    });

    it('caps search snippets for cloud callers', () => {
      const capped = applySnippetPolicy(
        [{ ref: { connector: 'local_folder', kind: 'file', id: 'f:1' }, score: 1, snippet: 'x'.repeat(400) }],
        { allowFullContent: false },
      );
      expect(capped[0]?.snippet?.length).toBe(MAX_CLOUD_SNIPPET_CHARS);
    });
  });

  describe('2. saved workflow run from plain chat', () => {
    it('workflows.list → workflows.run uses store id and hits approval gate', async () => {
      const db = await createDatabaseAsync(':memory:');
      const store = new WorkflowStore(db);
      const runtime = new WorkflowRuntime({
        store,
        globalActive: true,
        workflowActive: {},
        connectors: createTestConnectors(),
      });
      const { workflowId } = store.saveWorkflow(slackNotifyWorkflow());
      store.setWorkflowActive(workflowId, true);

      const listCtx = buildDesignToolContext([], [], undefined, {
        interactionMode: 'plain_chat',
        workflowActions: {
          list: () => store.listWorkflows().map((row) => ({ id: row.id, name: row.name, active: row.active })),
          run: (id) => runSavedWorkflowById({ store, runtime }, id),
        },
      });

      const [listed] = await executeDesignToolCalls([{ tool: 'workflows.list' }], listCtx);
      const rows = (listed?.data as { workflows: Array<{ id: string }> }).workflows;
      const ids = rows.map((row) => row.id);
      expect(ids).toContain(workflowId);

      const [run] = await executeDesignToolCalls([{ tool: 'workflows.run', args: { workflowId } }], listCtx);
      expect(run?.ok).toBe(true);
      const runData = run?.data as { status: string; executionId: string };
      expect(runData.status).toBe('pending_approval');
      expect(mockSlack(runtime.connectors).messages).toHaveLength(0);

      const execution = store.getExecution(runData.executionId);
      expect(execution?.status).toBe('pending_approval');
      const log = parseExecutionLog(execution?.logJson);
      expect(
        hasExecutionLogCode(log, 'waiting_approval') || hasExecutionLogCode(log, 'step_started'),
      ).toBe(true);
    });

    it('rejects workflows.run for ids not in workflows.list', async () => {
      const result = await executeDesignTool(
        { tool: 'workflows.run', args: { workflowId: 'ghost' } },
        buildDesignToolContext([], [], undefined, {
          interactionMode: 'plain_chat',
          workflowActions: {
            list: () => [{ id: 'known', name: 'Known', active: false }],
            run: async () => ({ executionId: 'x', status: 'success' }),
          },
        }),
      );
      expect(result.ok).toBe(false);
    });
  });

  describe('3. /once ephemeral execution snapshot', () => {
    it('ephemeral run keeps execution IR snapshot without saved workflow row', async () => {
      const db = await createDatabaseAsync(':memory:');
      const store = new WorkflowStore(db);
      const runtime = new WorkflowRuntime({
        store,
        globalActive: true,
        workflowActive: {},
        connectors: createTestConnectors(),
      });
      const ir = slackNotifyWorkflow({ allowExternalAuto: true });
      const result = await runtime.executeWorkflow(ir, { ephemeral: true, triggerType: 'manual', forceManual: true });
      expect(result.status).toBe('success');
      expect(store.listWorkflows()).toHaveLength(0);
      const execution = store.getExecution(result.executionId);
      expect(execution?.ephemeral).toBe(true);
      expect(execution?.workflowId).toBeNull();
      expect(execution?.irJson).toContain('Slack 알림');
    });
  });

  describe('4. save disabled + explicit enable', () => {
    it('new saves are inactive until setWorkflowActive(true)', async () => {
      const db = await createDatabaseAsync(':memory:');
      const store = new WorkflowStore(db);
      const { workflowId } = store.saveWorkflow(slackNotifyWorkflow({ allowExternalAuto: true }));
      expect(store.listWorkflows().find((row) => row.id === workflowId)?.active).toBe(false);
      store.setWorkflowActive(workflowId, true);
      expect(store.listWorkflows().find((row) => row.id === workflowId)?.active).toBe(true);
    });
  });

  describe('5–6. approval gate and duplicate resume', () => {
    it('EXTERNAL requires approval by default; HIGH never relaxes', () => {
      expect(requiresApproval('EXTERNAL', false)).toBe(true);
      expect(requiresApproval('EXTERNAL', true)).toBe(false);
      expect(requiresApproval('EXTERNAL_HIGH', true)).toBe(true);
    });

    it('prevents duplicate side effects when approval is resumed twice', async () => {
      const db = await createDatabaseAsync(':memory:');
      const store = new WorkflowStore(db);
      const runtime = new WorkflowRuntime({
        store,
        globalActive: true,
        workflowActive: {},
        connectors: createTestConnectors(),
      });
      const first = await runtime.executeWorkflow(slackNotifyWorkflow({ allowExternalAuto: false }), { ephemeral: true });
      expect(first.status).toBe('pending_approval');

      const [resumed, duplicate] = await Promise.all([
        runtime.continueAfterApproval(first.pendingApprovalId!),
        runtime.continueAfterApproval(first.pendingApprovalId!),
      ]);
      expect(resumed.status).toBe('success');
      expect(['approval_in_progress', 'approval_already_resolved']).toContain(duplicate.errorCode);
      expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
    });
  });

  describe('7. cloud model must not receive full untrusted source bodies', () => {
    it('harness redacts untrusted evidence for cloud backends', async () => {
      const model = new CloudSpyProvider();
      const harness = createAgentHarness(model);
      await harness.run({
        role: 'investigate',
        outputSchema: z.object({ ok: z.boolean() }),
        cloudAllowed: false,
        context: {
          skillGoal: 'g',
          taskGoal: 't',
          evidence: [{ source: 'gmail.messages.read', detail: 'secret-pdf-body' }],
          connectedConnectors: ['gmail'],
          untrustedData: 'secret-pdf-body',
        },
      });
      expect(model.sawSecret).toBe(false);
    });
  });

  describe('connector failure logging', () => {
    it('records openapi.request_failed in execution log on HTTP error', async () => {
      const { connector } = ingestOpenApiSpec('pets', {
        openapi: '3.0.0',
        servers: [{ url: 'https://api.example.com' }],
        paths: { '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } } },
      });
      const logs: Array<{ message: string; data?: unknown }> = [];
      const originalFetch = globalThis.fetch;
      globalThis.fetch = async () => new Response('fail', { status: 500, statusText: 'err' });
      try {
        await connector.execute('pets.listPets', {}, {
          executionId: 'qa-openapi',
          variables: {},
          log: (entry) => logs.push({ message: entry.message, data: entry.data }),
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
      expect(logs.some((entry) => entry.message === 'openapi.request_failed')).toBe(true);
    });
  });
});
