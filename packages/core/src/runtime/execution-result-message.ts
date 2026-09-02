import type { ExecutionLogEntry } from '../modules/types.js';
import { resolveCapability } from '../catalog/capability-graph.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import { parseWorkflowIR, type WorkflowIR } from '../workflow/schema.js';
import { formatApprovalTitle } from './approval-display.js';
import type { ExecutionResult } from './types.js';

export interface WorkspaceChatChangedEvent {
  sessionId: string;
  workflowId?: string;
  executionId: string;
}

const MAX_RESULT_CHARS = 8_000;
const MAX_FIELD_CHARS = 1_200;

const OUTPUT_FIELD_LABELS: Record<string, string> = {
  conclusion: '결론',
  summary: '요약',
  category: '분류',
  riskLevel: '위험도',
  confidence: '신뢰도',
  needMore: '추가 조회 필요',
  reason: '판단 이유',
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function safeText(value: unknown, max = MAX_FIELD_CHARS): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') return undefined;
  const text = String(value)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function outputPreviewFromLog(log: ExecutionLogEntry[]): Record<string, unknown> | undefined {
  const entry = [...log].reverse().find((candidate) => candidate.code === 'ai_decision_completed');
  return record(record(entry?.data)?.outputPreview);
}

function completedActionSummaries(
  irJson: string | undefined,
  log: ExecutionLogEntry[],
): string[] {
  if (!irJson) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(irJson);
  } catch {
    return [];
  }
  const workflow = record(parsed);
  const steps: unknown[] = Array.isArray(workflow?.steps) ? workflow.steps : [];
  const completedStepIds = new Set(
    log
      .filter((entry) => entry.code === 'step_completed')
      .map((entry) => record(entry.data)?.stepId)
      .filter((stepId): stepId is string => typeof stepId === 'string'),
  );
  const labels: string[] = [];
  for (const step of steps) {
    const item = record(step);
    if (!item || item.type !== 'action' || typeof item.id !== 'string' || !completedStepIds.has(item.id)) continue;
    const connector = typeof item.connector === 'string' ? item.connector : '';
    const action = typeof item.action === 'string' ? item.action : '';
    const capability = resolveCapability(connector, action);
    const label = capability?.label ? `${capability.label} 완료` : undefined;
    if (label && !labels.includes(label)) labels.push(label);
  }
  return labels;
}

function statusLine(result: ExecutionResult, workflowName?: string): string {
  const subject = workflowName ? `「${safeText(workflowName, 240) ?? '업무'}」` : '업무';
  switch (result.status) {
    case 'success':
      return `${subject} 실행이 완료되었습니다.`;
    case 'pending_approval':
      return `${subject} 실행이 승인 대기 중입니다.`;
    case 'cancelled':
      return `${subject} 실행이 취소되었습니다.`;
    case 'failed':
      return `${subject} 실행에 실패했습니다.`;
  }
}

export function formatExecutionResultMessage(
  result: ExecutionResult,
  options: { workflowName?: string; irJson?: string; inlineApproval?: boolean } = {},
): string {
  const lines = [statusLine(result, options.workflowName)];
  const actions = completedActionSummaries(options.irJson, result.log);
  if (actions.length > 0) lines.push(`완료한 작업: ${actions.join(', ')}`);

  const preview = outputPreviewFromLog(result.log);
  if (preview) {
    const category = safeText(preview.category, 120);
    if (category === 'insufficient_evidence' || category === 'undetermined') {
      lines.push('결과 품질: 근거 부족');
    }
    for (const [field, label] of Object.entries(OUTPUT_FIELD_LABELS)) {
      const value = safeText(preview[field]);
      if (value) lines.push(`${label}: ${value}`);
    }
  }

  if (result.status === 'failed' && result.errorCode) {
    lines.push(`오류 코드: ${safeText(result.errorCode, 160) ?? 'unknown'}`);
  }
  if (result.status === 'pending_approval' && result.pendingApprovalId) {
    lines.push(
      options.inlineApproval
        ? '대화에서 승인하거나 취소할 수 있습니다.'
        : '승인 요청이 활동에 기록되었습니다.',
    );
  }
  lines.push(`실행 ID: ${safeText(result.executionId, 160) ?? 'unknown'}`);
  return lines.join('\n').slice(0, MAX_RESULT_CHARS);
}

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
): import('../store/repositories/workspace-chat-repository.js').WorkspaceChatApproval | undefined {
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
  });
  if (!updated) return null;
  return {
    sessionId: chat.id,
    ...(workflowId ? { workflowId } : {}),
    executionId: result.executionId,
  };
}
