import { randomUUID } from 'node:crypto';
import { EditableToolResultSchema, MessageSendBindingSchema, ToolDraftUpdateSchema, ToolReviewRequestSchema,
  ToolResultConfirmationSchema, ToolSendOutcomeSchema, messageTool, messageToolDraft, messageToolParams, missingToolEssentials,
  validGmailRecipient, type EditableToolResult, type MessageToolDraft, type ToolResultConfirmation,
  type ToolResultReference, type ToolResultReview } from '../contracts/tool-result.js';
import type { Connector, ConnectorContext } from '../connectors/types.js';
import type { WorkflowStore } from '../persistence/workflow-store.js';
import { parseWorkflowIR } from '../workflow/schema.js';
import { approvalParamsHash } from './approval-snapshot.js';
import { isExecutionCheckpoint } from './control-flow.js';
import { resolveActionParamsForExecution } from './step-executor.js';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Reconstruct exact original data from existing execution evidence, never a second stored body. */
export function editableToolResult(store: WorkflowStore, approvalId: string): EditableToolResult | undefined {
  const approval = store.getApproval(approvalId);
  if (!approval || approval.status !== 'pending' || approval.actionIds.length !== 1) return undefined;
  const execution = store.getExecution(approval.executionId);
  if (!execution?.ephemeral || !execution.workspaceSessionId || execution.status !== 'pending_approval') return undefined;
  if (!store.hasWorkspaceChat(execution.workspaceSessionId)) return undefined;
  const payload = record(approval.payload);
  const checkpoint = payload.checkpoint;
  if (payload.type === 'human_approval' || !isExecutionCheckpoint(checkpoint)
    || checkpoint.remainingStepIds.length || checkpoint.pendingOuterStepIds?.length) return undefined;
  if (!Array.isArray(payload.actionSnapshots) || payload.actionSnapshots.length !== 1) return undefined;
  const snapshot = record(payload.actionSnapshots[0]);
  if (snapshot.actionId !== approval.actionIds[0] || typeof snapshot.actionRef !== 'string') return undefined;
  const tool = messageTool(snapshot.actionRef);
  if (!tool) return undefined;
  const ir = parseWorkflowIR(JSON.parse(execution.irJson ?? ''));
  const step = ir.steps.find(item => item.id === snapshot.actionId);
  if (step?.type !== 'action') throw new Error('tool_result_stale');
  const ctx: ConnectorContext = { executionId: execution.id, workspaceSessionId: execution.workspaceSessionId,
    variables: checkpoint.variables, outputs: checkpoint.outputs,
    presentationVariableSources: checkpoint.presentationVariableSources, log: () => undefined };
  const resolved = resolveActionParamsForExecution(step, ir, ctx, checkpoint.stepResults);
  if (resolved.actionDefinition.id !== snapshot.actionRef || approvalParamsHash(resolved.params) !== snapshot.paramsHash) {
    throw new Error('approval_target_changed');
  }
  const keys = tool === 'gmail' ? ['to', 'subject', 'body'] : ['channel', 'text'];
  const blockedFields = Object.keys(resolved.params).filter(key => !keys.includes(key));
  const draft = messageToolDraft(snapshot.actionRef, Object.fromEntries(keys
    .filter(key => key in resolved.params).map(key => [key, resolved.params[key]])));
  if (!draft) throw new Error('tool_result_invalid_original');
  const revision = store.getConnectionRevision();
  return EditableToolResultSchema.parse({
    approvalId, executionId: execution.id, workspaceSessionId: execution.workspaceSessionId,
    actionId: snapshot.actionId, paramsHash: snapshot.paramsHash, tool, draft, revision: 0,
    connectionRevision: revision, connectionHash: approvalParamsHash({ tool, revision }), blockedFields,
    ...(typeof resolved.params.thread_ts === 'string' ? { threadReference: resolved.params.thread_ts } : {}),
  });
}

export function toolResultReference(source: EditableToolResult): ToolResultReference {
  return { approvalId: source.approvalId, executionId: source.executionId,
    workspaceSessionId: source.workspaceSessionId, actionId: source.actionId,
    paramsHash: source.paramsHash, tool: source.tool };
}

/** Classify even malformed/unsupported editable approvals so generic approve fails closed. */
export function requiresToolResultReview(store: WorkflowStore, approvalId: string): boolean {
  const approval = store.getApproval(approvalId);
  const execution = approval && store.getExecution(approval.executionId);
  if (!execution?.ephemeral || !execution.workspaceSessionId || approval?.actionIds.length !== 1) return false;
  const payload = record(approval.payload);
  const checkpoint = payload.checkpoint;
  if (payload.type === 'human_approval' || !isExecutionCheckpoint(checkpoint)
    || checkpoint.remainingStepIds.length || checkpoint.pendingOuterStepIds?.length) return false;
  const snapshots = payload.actionSnapshots;
  return Array.isArray(snapshots) && snapshots.some(value => {
    const item = record(value);
    return typeof item.actionRef === 'string' && !!messageTool(item.actionRef);
  });
}

type DraftEntry = { source: EditableToolResult; draft: MessageToolDraft; revision: number; reviewGeneration: number; seal?: PreparedToolSend };
export interface PreparedToolSend {
  source: EditableToolResult;
  review: ToolResultReview;
  connector: Connector;
  params: Record<string, unknown>;
}

/** Per-runtime memory only. Seals cannot survive restart or dispatch twice. */
export class ToolResultApprovals {
  private readonly drafts = new Map<string, DraftEntry>();
  private readonly stopObservingDeletion: () => void;
  constructor(private readonly store: WorkflowStore, private readonly connectors: Record<string, Connector>) {
    // Checkpoints pair approval and execution across interrupted durable writes.
    // Recovery changes metadata only. It never resumes a provider send.
    for (const approval of store.getApprovalRecoveryCandidates()) {
      if (!requiresToolResultReview(store, approval.id)) continue;
      const execution = store.getExecution(approval.executionId)!;
      let previousLog: unknown[] = [];
      try { const parsed: unknown = JSON.parse(execution.logJson); if (Array.isArray(parsed)) previousLog = parsed; }
      catch { /* An unavailable legacy log cannot determine provider outcome. */ }
      if (approval.status === 'pending') {
        if (execution.status === 'running') store.markExecutionPending(execution.id, 'pending_approval', [...previousLog,
          { at: new Date().toISOString(), level: 'info', code: 'tool_result_pending_recovered',
            message: 'Recovered original approval checkpoint. Fresh review is required.' }]);
        continue;
      }
      if (approval.status === 'rejected') {
        store.finishExecution(execution.id, 'cancelled', 'approval_rejected', [...previousLog,
          { at: new Date().toISOString(), level: 'info', code: 'approval_rejected', message: 'Recovered durable cancellation. No send.' }]);
        continue;
      }
      const payload = record(approval.payload);
      const outcome = ToolSendOutcomeSchema.safeParse(payload.toolSendOutcome);
      const sent = outcome.success && outcome.data.status === 'sent';
      if (approval.status === 'processing') {
        if (sent) store.resolveApproval(approval.id, true);
        else store.failApproval(approval.id);
      }
      store.finishExecution(approval.executionId, sent ? 'success' : 'failed', sent ? undefined : 'tool_send_unknown',
        [...previousLog, { at: new Date().toISOString(), level: sent ? 'info' : 'warn',
          code: sent ? 'tool_send_receipt_recovered' : 'tool_send_unknown',
          message: sent ? 'Recovered confirmed provider receipt.' : 'Interrupted send outcome is unknown. No automatic retry.' }]);
    }
    this.stopObservingDeletion = store.onWorkspaceChatDeleted(id => this.discardSession(id));
  }

  read(approvalId: string): EditableToolResult | undefined {
    const source = editableToolResult(this.store, approvalId);
    if (!source) { this.drafts.delete(approvalId); return undefined; }
    const entry = this.drafts.get(approvalId);
    if (entry && entry.source.paramsHash === source.paramsHash && entry.source.workspaceSessionId === source.workspaceSessionId) {
      if (entry.source.connectionRevision !== source.connectionRevision) entry.seal = undefined;
      entry.source = source;
      return { ...source, draft: structuredClone(entry.draft), revision: entry.revision };
    }
    this.drafts.set(approvalId, { source, draft: structuredClone(source.draft), revision: 0, reviewGeneration: 0 });
    return source;
  }

  update(input: unknown): EditableToolResult {
    const request = ToolDraftUpdateSchema.parse(input);
    const source = this.read(request.approvalId);
    const entry = this.drafts.get(request.approvalId);
    if (!source || !entry || source.workspaceSessionId !== request.workspaceSessionId
      || source.tool !== request.draft.tool || request.revision < entry.revision
      || (request.revision === entry.revision && approvalParamsHash(messageToolParams(request.draft)) !== approvalParamsHash(messageToolParams(entry.draft)))) {
      throw new Error('tool_result_stale');
    }
    if (request.revision > entry.revision) {
      entry.draft = structuredClone(request.draft);
      entry.revision = request.revision;
      entry.seal = undefined;
    }
    return { ...source, draft: structuredClone(entry.draft), revision: entry.revision };
  }

  async review(input: unknown): Promise<ToolResultReview> {
    const request = ToolReviewRequestSchema.parse(input);
    const source = this.read(request.approvalId);
    const entry = this.drafts.get(request.approvalId);
    if (!source || !entry || source.workspaceSessionId !== request.workspaceSessionId || request.revision !== entry.revision) throw new Error('tool_result_stale');
    const reviewGeneration = ++entry.reviewGeneration;
    entry.seal = undefined;
    if (source.blockedFields.length) throw new Error('tool_result_unsupported_fields');
    if (missingToolEssentials(entry.draft).length) throw new Error('tool_result_essentials_missing');
    if (entry.draft.tool === 'gmail' && !validGmailRecipient(entry.draft.to)) throw new Error('tool_result_recipient_invalid');
    const connection = this.store.getConnections().find(item => item.connector === source.tool);
    const connector = this.connectors[source.tool];
    if (!connection?.connected || !connector?.prepareMessageSend) throw new Error('tool_result_identity_unverified');
    const draft = structuredClone(entry.draft);
    const binding = MessageSendBindingSchema.parse(await connector.prepareMessageSend(draft));
    if (binding.provider !== source.tool || (source.tool === 'slack' && !binding.workspaceId)) throw new Error('tool_result_identity_unverified');
    const current = this.read(request.approvalId);
    if (!current || this.drafts.get(request.approvalId) !== entry || entry.reviewGeneration !== reviewGeneration || entry.revision !== request.revision
      || current.connectionRevision !== source.connectionRevision || this.connectors[source.tool] !== connector) throw new Error('tool_result_stale');
    if (draft.tool === 'gmail') draft.to = binding.destinationId;
    else draft.channel = binding.destinationId;
    const review: ToolResultReview = {
      confirmation: { approvalId: source.approvalId, workspaceSessionId: source.workspaceSessionId, sealId: randomUUID() },
      revision: entry.revision, draft, binding, paramsHash: approvalParamsHash(messageToolParams(draft)),
    };
    entry.seal = { source, review: structuredClone(review), connector, params: messageToolParams(draft) };
    return structuredClone(review);
  }

  prepare(approvalId: string, input: ToolResultConfirmation): PreparedToolSend {
    const confirmation = ToolResultConfirmationSchema.parse(input);
    const source = this.read(approvalId);
    const entry = this.drafts.get(approvalId);
    const seal = entry?.seal;
    if (!source || !seal || confirmation.approvalId !== approvalId
      || confirmation.workspaceSessionId !== source.workspaceSessionId
      || confirmation.sealId !== seal.review.confirmation.sealId
      || entry.revision !== seal.review.revision || source.paramsHash !== seal.source.paramsHash
      || source.connectionRevision !== seal.source.connectionRevision
      || this.connectors[source.tool] !== seal.connector
      || !this.store.getConnections().some(item => item.connector === source.tool && item.connected)) throw new Error('tool_result_stale');
    return seal;
  }
  consume(approvalId: string) { const entry = this.drafts.get(approvalId); if (entry) entry.seal = undefined; }
  discard(approvalId: string) { this.drafts.delete(approvalId); }
  discardSession(sessionId: string) {
    for (const [id, entry] of this.drafts) if (entry.source.workspaceSessionId === sessionId) this.drafts.delete(id);
  }
  dispose() { this.stopObservingDeletion(); this.drafts.clear(); }
}
