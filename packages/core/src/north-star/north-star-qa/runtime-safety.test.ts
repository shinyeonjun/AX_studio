import { afterEach, describe, expect, it } from 'vitest';
import { clearDynamicCatalogForTests } from '../../catalog/dynamic-catalog.js';
import { createTestConnectors, mockSlack } from '../../modules/test-connectors.js';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { WorkflowRuntime } from '../../runtime/engine.js';
import { requiresApproval } from '../../workflow/approval.js';
import { setDocumentEngineClient } from '../../document-engine/engine-client.js';
import { slackNotifyWorkflow } from './fixtures.js';

describe('North Star QA runtime and approval safety', () => {
  afterEach(() => {
    clearDynamicCatalogForTests();
    setDocumentEngineClient(null);
  });

  describe('2. ephemeral execution snapshot', () => {
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

  describe('3. save disabled + explicit enable', () => {
    it('new saves are inactive until setWorkflowActive(true)', async () => {
      const db = await createDatabaseAsync(':memory:');
      const store = new WorkflowStore(db);
      const { workflowId } = store.saveWorkflow(slackNotifyWorkflow({ allowExternalAuto: true }));
      expect(store.listWorkflows().find((row) => row.id === workflowId)?.active).toBe(false);
      store.setWorkflowActive(workflowId, true);
      expect(store.listWorkflows().find((row) => row.id === workflowId)?.active).toBe(true);
    });
  });

  describe('4–5. approval gate and duplicate resume', () => {
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
});
