import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import { createAxStudioCore } from './bootstrap.js';
import type { Connector } from '../connectors/types.js';
import type { MessageToolDraft } from '../contracts/tool-result.js';
import type { WorkflowIR } from '../workflow/schema.js';

vi.mock('../persistence/paths/app-log.js', () => ({ appendAppLog: vi.fn() }));

async function pending(tool: 'gmail' | 'slack') {
  const dataRoot = mkdtempSync(join(tmpdir(), 'ax-tool-metadata-combined-'));
  const dbPath = join(dataRoot, 'state.db');
  const core = await createAxStudioCore({ dataRoot, dbPath });
  core.runtime.setGlobalActive(true);
  const userText = 'Synthetic registered transcript';
  const session = core.store.saveWorkspaceChat({
    messages: [{ role: 'user', content: userText, turnId: 'metadata-turn' }],
    registeredMetadataParticipation: true,
  });
  core.store.setConnection(tool, true, { label: 'Unverified stored label' });
  const sends: Array<{ params: Record<string, unknown>; literal: boolean }> = [];
  const connector: Connector = {
    name: tool,
    prepareMessageSend: async draft => {
      if (draft.tool !== tool) throw new Error('Synthetic provider mismatch');
      return draft.tool === 'gmail'
        ? { provider: 'gmail', accountId: 'verified@example.test', accountLabel: 'Verified fixture account',
          destinationId: draft.to, destinationLabel: draft.to }
        : { provider: 'slack', accountId: 'U12345678', accountLabel: 'Verified fixture bot',
          workspaceId: 'T12345678', workspaceLabel: 'Verified fixture workspace',
          destinationId: 'C12345678', destinationLabel: '#fixture' };
    },
    execute: async (_action, params, context) => {
      sends.push({ params: structuredClone(params), literal: context.literalMessage === true });
      return { ok: true, data: tool === 'gmail' ? { id: 'combined-fixture-receipt' }
        : { ts: '100.001', channel: 'C12345678' } };
    },
  };
  core.runtime.setConnector(tool, connector);
  const workflow: WorkflowIR = {
    name: 'Synthetic combined send', goal: 'Preserve transcript and provider authority', version: 1, inputs: [],
    steps: [{ type: 'action', id: 'send', connector: tool, action: 'message.send',
      sideEffect: tool === 'gmail' ? 'EXTERNAL_HIGH' : 'EXTERNAL',
      params: tool === 'gmail' ? { to: 'original@example.test', subject: 'Fixture', body: 'Original body' }
        : { channel: '#fixture', text: 'Original message' } }],
    permissions: {}, approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
  };
  const result = await core.runtime.executeWorkflow(workflow, { ephemeral: true, workspaceSessionId: session.id });
  expect(result.status).toBe('pending_approval');
  const approvalId = result.pendingApprovalId!;
  const source = core.runtime.getToolResult(approvalId)!;
  const draft: MessageToolDraft = tool === 'gmail'
    ? { tool, to: 'edited@example.test', subject: 'Edited fixture', body: 'Manual {{literal}} body' }
    : { tool, channel: '#fixture', text: 'Manual {{literal}} message' };
  const revision = source.revision + 1;
  core.runtime.updateToolDraft({ approvalId, workspaceSessionId: session.id, revision, draft });
  const review = await core.runtime.reviewToolResult({ approvalId, workspaceSessionId: session.id, revision });
  let closed = false;
  const close = async () => {
    if (closed) return;
    core.runtime.stopAccepting();
    await core.runtime.waitForIdle();
    core.db.close?.();
    closed = true;
  };
  return { core, session, userText, sends, approvalId, executionId: result.executionId, review, draft, dataRoot, dbPath, close };
}

describe('tool results composed with metadata transcript fences', () => {
  it.each(['gmail', 'slack'] as const)('keeps %s literal receipts while rejecting old transcript writers', async tool => {
    const fixture = await pending(tool);
    const { core, session } = fixture;
    try {
      const pendingChat = core.store.getWorkspaceChat(session.id)!;
      expect(pendingChat.transcriptRevision).not.toBe(session.transcriptRevision);
      expect(pendingChat.messages.some(message => message.approval?.toolResult?.approvalId === fixture.approvalId)).toBe(true);
      expect(() => core.store.saveWorkspaceChat({ id: session.id, messages: session.messages,
        expectedTranscriptRevision: session.transcriptRevision })).toThrow('workspace_chat_revision_conflict');
      expect(fixture.sends).toHaveLength(0);
      const metadataReply = core.store.appendWorkspaceChatMetadataReply({
        sessionId: session.id, turnId: 'metadata-turn', userText: fixture.userText,
        reply: 'Synthetic local metadata answer', expectedTranscriptRevision: pendingChat.transcriptRevision!,
        assertCurrent: () => undefined,
      });
      const outcomes = await Promise.all([
        core.runtime.continueAfterApproval(fixture.approvalId, fixture.review.confirmation),
        core.runtime.continueAfterApproval(fixture.approvalId, fixture.review.confirmation),
      ]);
      const successes = outcomes.filter(outcome => outcome.status === 'success');
      expect(successes).toHaveLength(1);
      expect(successes[0]!.toolSendOutcome).toMatchObject({ status: 'sent', receiptId: tool === 'gmail' ? 'combined-fixture-receipt' : '100.001' });
      expect(fixture.sends).toEqual([{ literal: true, params: tool === 'gmail'
        ? { to: 'edited@example.test', subject: 'Edited fixture', body: 'Manual {{literal}} body' }
        : { channel: 'C12345678', text: 'Manual {{literal}} message' } }]);
      const completed = core.store.getWorkspaceChat(session.id)!;
      expect(completed.transcriptRevision).not.toBe(metadataReply.transcriptRevision);
      expect(completed.messages[0]).toMatchObject({ turnId: 'metadata-turn', registeredMetadataTurn: true });
      expect(completed.messages.some(message => message.content === 'Synthetic local metadata answer')).toBe(true);
      expect(completed.messages.find(message => message.executionId === fixture.executionId)?.toolSendOutcome)
        .toEqual(successes[0]!.toolSendOutcome);
      expect(() => core.store.saveWorkspaceChat({ id: session.id, messages: metadataReply.messages,
        expectedTranscriptRevision: metadataReply.transcriptRevision })).toThrow('workspace_chat_revision_conflict');
      expect(() => core.store.appendWorkspaceChatMetadataReply({ sessionId: session.id, turnId: 'metadata-turn',
        userText: fixture.userText, reply: 'Late metadata answer', expectedTranscriptRevision: metadataReply.transcriptRevision!,
        assertCurrent: () => undefined })).toThrow('workspace_chat_revision_conflict');
      expect(core.store.getWorkspaceChat(session.id)).toEqual(completed);
      expect((await core.runtime.continueAfterApproval(fixture.approvalId, fixture.review.confirmation)).status).not.toBe('success');
      expect(fixture.sends).toHaveLength(1);
      expect(core.store.getExecution(fixture.executionId)?.status).toBe('success');
      expect(core.store.getApproval(fixture.approvalId)?.status).toBe('approved');
    } finally { await fixture.close(); }
  });

  it.each(['gmail', 'slack'] as const)('deletes %s draft authority and fenced transcript durably', async tool => {
    const fixture = await pending(tool);
    try {
      const current = fixture.core.store.getWorkspaceChat(fixture.session.id)!;
      fixture.core.store.deleteWorkspaceChat(fixture.session.id);
      expect(fixture.core.runtime.getToolResult(fixture.approvalId)).toBeUndefined();
      expect((await fixture.core.runtime.continueAfterApproval(fixture.approvalId, fixture.review.confirmation)).status).not.toBe('success');
      expect(() => fixture.core.store.saveWorkspaceChat({ id: current.id, messages: current.messages,
        expectedTranscriptRevision: current.transcriptRevision })).toThrow('workspace_chat_not_found');
      expect(fixture.sends).toHaveLength(0);
      await fixture.close();
      const reopened = await createAxStudioCore({ dataRoot: fixture.dataRoot, dbPath: fixture.dbPath });
      try {
        expect(reopened.store.hasWorkspaceChat(current.id)).toBe(false);
        expect(reopened.runtime.getToolResult(fixture.approvalId)).toBeUndefined();
        expect(() => reopened.store.saveWorkspaceChat({ id: current.id, messages: current.messages,
          expectedTranscriptRevision: current.transcriptRevision })).toThrow('workspace_chat_not_found');
        expect(fixture.sends).toHaveLength(0);
      } finally {
        reopened.runtime.stopAccepting();
        await reopened.runtime.waitForIdle();
        reopened.db.close?.();
      }
    } finally { await fixture.close(); }
  });
});
