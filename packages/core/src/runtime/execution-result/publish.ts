import type { WorkflowStore } from '../../store/workflow-store.js';
import { parseWorkflowIR, type WorkflowIR } from '../../workflow/schema.js';
import { formatApprovalTitle } from '../approval-display.js';
import type { ExecutionResult } from '../types.js';
import { formatExecutionResultMessage, safeText } from './format.js';
import type { WorkspaceChatChangedEvent } from './contracts.js';
import { generatedPdfFromExecutionLog } from './generated-pdf.js';

function parseExecutionIr(irJson: string | null | undefined): WorkflowIR | null {
  if (!irJson) return null;
  try {
    return parseWorkflowIR(JSON.parse(irJson));
  } catch {
    return null;
  }
}

function inlineApprovalForExecution(
  store: WorkflowStore,
  result: ExecutionResult,
  execution: { ephemeral: boolean; irJson?: string },
  ir: WorkflowIR | null,
): import('../../store/repositories/workspace-chat-repository.js').WorkspaceChatApproval | undefined {
  if (!execution.ephemeral || result.status !== 'pending_approval' || !result.pendingApprovalId) return undefined;

  try {
    const approval = store.getApproval(result.pendingApprovalId);
    if (!approval || approval.status !== 'pending') return undefined;
    const title = formatApprovalTitle({
      workName: ir?.name,
      reason: approval.reason,
      actionIds: approval.actionIds,
      ir,
    });
    const reason = safeText(approval.reason, 1_200);
    const safeTitle = safeText(title, 240);
    if (!reason || !safeTitle) return undefined;
    return {
      id: approval.id,
      title: safeTitle,
      reason,
    };
  } catch {
    // A malformed approval must not prevent the execution result from being
    // delivered. The approval tab remains the durable recovery path.
    return undefined;
  }
}

/**
 * Publishes a finished runtime lifecycle result to the chat mapped to the
 * saved workflow or the originating session for an ephemeral run. Unmapped
 * executions remain Activity-only.
 */
export function publishExecutionResultToWorkspaceChat(
  store: WorkflowStore,
  result: ExecutionResult,
): WorkspaceChatChangedEvent | null {
  const execution = store.getExecution(result.executionId);
  const workflowId = execution?.workflowId;
  const workspaceSessionId = execution?.workspaceSessionId;
  if (!execution || (!workflowId && !workspaceSessionId)) return null;

  const chat = workspaceSessionId
    ? store.getWorkspaceChat(workspaceSessionId)
    : workflowId
      ? store.getWorkspaceChatByWorkflowId(workflowId)
      : undefined;
  if (!chat) return null;

  const executionIr = parseExecutionIr(execution.irJson);
  const workflowName = executionIr?.name;
  const inlineApproval = inlineApprovalForExecution(store, result, execution, executionIr);
  const generatedPdf = generatedPdfFromExecutionLog(result.log);

  const updated = store.upsertWorkspaceChatExecutionResult(chat.id, {
    role: 'assistant',
    kind: 'execution_result',
    executionId: result.executionId,
    executionStatus: result.status,
    content: formatExecutionResultMessage(result, {
      workflowName,
      irJson: execution.irJson ?? undefined,
      inlineApproval: Boolean(inlineApproval),
    }),
    ...(inlineApproval ? { approval: inlineApproval } : {}),
    ...(generatedPdf ? { generatedPdf } : {}),
  });
  if (!updated) return null;
  return {
    sessionId: chat.id,
    ...(workflowId ? { workflowId } : {}),
    executionId: result.executionId,
  };
}
