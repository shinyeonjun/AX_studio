import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseAsync, WorkflowStore, WorkflowRuntime } from '@ax-studio/core';
import { syntheticSlackApprovalConnector, syntheticSlackApprovalPlan } from './slack-approval.js';

const databases: Awaited<ReturnType<typeof createDatabaseAsync>>[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close?.()));

async function pending(legacy = false) {
  const db = await createDatabaseAsync(':memory:');
  databases.push(db);
  const store = new WorkflowStore(db);
  store.setConnection('slack', true, { synthetic: true });
  const session = store.saveWorkspaceChat({ messages: [{ role: 'user', content: 'E2E fixture' }] });
  const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {},
    connectors: { slack: syntheticSlackApprovalConnector() } });
  const result = await runtime.executeWorkflow(syntheticSlackApprovalPlan(legacy), {
    ephemeral: true, workspaceSessionId: session.id,
  });
  expect(result.status, JSON.stringify(result)).toBe('pending_approval');
  const audit = () => JSON.parse(store.getExecution(result.executionId)!.logJson)
    .filter((entry: { code?: string }) => entry.code === 'e2e_slack_send');
  return { runtime, store, session, result, audit, id: result.pendingApprovalId! };
}

describe('synthetic Slack approval fixture uses real runtime gates', () => {
  it('requires review and sends the complete literal override once with a receipt', async () => {
    const f = await pending();
    expect((await f.runtime.continueAfterApproval(f.id)).errorCode).toBe('tool_result_confirmation_required');
    expect(f.audit()).toEqual([]);
    const source = f.runtime.getToolResult(f.id)!;
    f.runtime.updateToolDraft({ approvalId: f.id, workspaceSessionId: f.session.id, revision: source.revision + 1,
      draft: { tool: 'slack', channel: '#e2e-edited', text: 'E2E edited {{literal}}\n**exact payload**' } });
    const review = await f.runtime.reviewToolResult({ approvalId: f.id, workspaceSessionId: f.session.id, revision: 1 });
    expect(review.binding).toMatchObject({ accountId: 'U12345678', workspaceId: 'T12345678', destinationId: 'C87654321' });
    expect(f.audit()).toEqual([]);
    const results = await Promise.all([f.runtime.continueAfterApproval(f.id, review.confirmation),
      f.runtime.continueAfterApproval(f.id, review.confirmation)]);
    expect(results.filter(result => result.status === 'success')).toHaveLength(1);
    expect(results.find(result => result.status === 'success')?.toolSendOutcome)
      .toMatchObject({ status: 'sent', receiptId: '100.001' });
    expect(f.audit().map((entry: { data: unknown }) => entry.data)).toEqual([{
      action: 'message.send', params: { channel: 'C87654321', text: 'E2E edited {{literal}}\n**exact payload**' },
      literalMessage: true, executionId: f.result.executionId, workspaceSessionId: f.session.id,
    }]);
  });
  it('does not guess unknown destinations and rejection records zero sends', async () => {
    const f = await pending();
    f.runtime.updateToolDraft({ approvalId: f.id, workspaceSessionId: f.session.id, revision: 1,
      draft: { tool: 'slack', channel: '#unknown', text: 'E2E' } });
    await expect(f.runtime.reviewToolResult({ approvalId: f.id, workspaceSessionId: f.session.id, revision: 1 }))
      .rejects.toThrow('tool_result_destination_unknown');
    expect(f.store.rejectPendingApproval(f.id)).toBe(true);
    f.runtime.discardToolDraft(f.id);
    expect(f.store.getApproval(f.id)?.status).toBe('rejected');
    expect(f.audit()).toEqual([]);
  });
  it.each(['approve', 'reject'] as const)('retains generic legacy %s coverage for a continuation', async decision => {
    const f = await pending(true);
    expect(f.runtime.getToolResult(f.id)).toBeUndefined();
    expect(f.audit()).toEqual([]);
    if (decision === 'approve') {
      expect((await f.runtime.continueAfterApproval(f.id)).status).toBe('success');
      expect(f.audit()).toHaveLength(1);
    } else {
      expect(f.store.rejectPendingApproval(f.id)).toBe(true);
      f.runtime.discardToolDraft(f.id);
      expect(f.store.getApproval(f.id)?.status).toBe('rejected');
      expect(f.audit()).toEqual([]);
    }
  });
});
