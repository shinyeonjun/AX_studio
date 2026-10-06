import type { ExecutionLogEntry } from '../connectors/types.js';
import type { WorkflowStore } from '../persistence/workflow-store.js';
import { isExecutionCheckpoint } from './control-flow.js';
import type { ExecutionResult } from './types.js';

/** Pending approvals older than this are expired and can no longer be approved. */
export const DEFAULT_APPROVAL_TTL_MS = 72 * 60 * 60 * 1_000;

type Approval = NonNullable<ReturnType<WorkflowStore['getApproval']>>;

function previousLog(store: WorkflowStore, executionId: string): { log: unknown[]; rawLog: unknown[]; preserveHistory: boolean } {
  const execution = store.getExecution(executionId);
  let log: unknown[] = [];
  try {
    const parsed: unknown = JSON.parse(execution?.logJson ?? '[]');
    if (Array.isArray(parsed)) log = parsed;
  } catch {
    // A malformed legacy log must not block the terminal transition.
  }
  // Rewriting a diagnosed preview log would erase its raw tail; keep it untouched.
  const preserveHistory = Boolean(execution?.historyDiagnostics?.some((diagnostic) => diagnostic.source !== 'output'));
  return { log: preserveHistory ? [] : log, rawLog: log, preserveHistory };
}

function finish(
  store: WorkflowStore,
  executionId: string,
  status: 'failed' | 'cancelled',
  errorCode: string,
  entry: Omit<ExecutionLogEntry, 'at'>,
  options: { keepLog?: boolean } = {},
): ExecutionResult {
  const finalEntry: ExecutionLogEntry = { at: new Date().toISOString(), ...entry };
  if (options.keepLog) {
    // Restart recovery only closes the record; the stored log (and any raw
    // preview tail behind it) stays byte-for-byte as the interrupted run left it.
    store.finishExecution(executionId, status, errorCode, undefined, { preserveHistory: true });
  } else {
    const { log, preserveHistory } = previousLog(store, executionId);
    store.finishExecution(executionId, status, errorCode, [...log, finalEntry], { preserveHistory });
  }
  return { executionId, status, errorCode, log: [finalEntry] };
}

function approvalAgeMs(approval: Pick<Approval, 'createdAt'>, now: number): number {
  const createdAt = Date.parse(approval.createdAt);
  // An unreadable timestamp cannot prove freshness; treat it as expired (fail closed).
  return Number.isFinite(createdAt) ? now - createdAt : Number.POSITIVE_INFINITY;
}

export function isApprovalExpired(
  approval: Pick<Approval, 'createdAt'>,
  ttlMs = DEFAULT_APPROVAL_TTL_MS,
  now = Date.now(),
): boolean {
  return approvalAgeMs(approval, now) > ttlMs;
}

/**
 * Expires one still-pending approval. The approval becomes `rejected` and its
 * execution is cancelled with `approval_expired`; nothing is executed.
 */
export function expireApproval(store: WorkflowStore, approval: Approval): ExecutionResult | undefined {
  if (!store.rejectPendingApproval(approval.id)) return undefined;
  return finish(store, approval.executionId, 'cancelled', 'approval_expired', {
    level: 'warn',
    code: 'approval_expired',
    message: '승인 대기 시간이 만료되어 실행을 취소했습니다. 외부 작업은 실행되지 않았습니다.',
    data: { approvalId: approval.id },
  });
}

export function expireStaleApprovals(
  store: WorkflowStore,
  ttlMs = DEFAULT_APPROVAL_TTL_MS,
  now = Date.now(),
): Array<{ approvalId: string; result: ExecutionResult }> {
  const results: Array<{ approvalId: string; result: ExecutionResult }> = [];
  for (const approval of store.getPendingApprovals()) {
    if (!isApprovalExpired(approval, ttlMs, now)) continue;
    try {
      const result = expireApproval(store, approval);
      if (result) results.push({ approvalId: approval.id, result });
    } catch (error) {
      console.error(`[runtime] approval expiry failed for ${approval.id}:`, error);
    }
  }
  return results;
}

/**
 * Restart reconciliation for every execution. It runs before any new work is
 * accepted, so no execution can have a live runner. Recovery only changes
 * metadata: an interrupted external step has an unknown outcome and is never
 * retried automatically.
 */
export function reconcileInterruptedExecutions(store: WorkflowStore): void {
  const pendingByExecution = new Map<string, Approval[]>();
  for (const approval of store.getPendingApprovals()) {
    const list = pendingByExecution.get(approval.executionId) ?? [];
    list.push(approval);
    pendingByExecution.set(approval.executionId, list);
  }
  const rejectPending = (executionId: string) => {
    for (const approval of pendingByExecution.get(executionId) ?? []) store.rejectPendingApproval(approval.id);
    pendingByExecution.delete(executionId);
  };

  const closed = new Set<string>();
  for (const approval of store.getProcessingApprovals()) {
    store.failApproval(approval.id);
    rejectPending(approval.executionId);
    const execution = store.getExecution(approval.executionId);
    if (execution && (execution.status === 'running' || execution.status === 'pending_approval')) {
      finish(store, approval.executionId, 'failed', 'interrupted', {
        level: 'warn',
        code: 'interrupted',
        message: '승인 후 실행 도중 앱이 종료되었습니다. 외부 작업 결과를 알 수 없으므로 자동으로 다시 실행하지 않습니다.',
        data: { approvalId: approval.id, outcome: 'unknown' },
      }, { keepLog: true });
    }
    closed.add(approval.executionId);
  }

  for (const execution of store.listUnfinishedExecutions()) {
    if (closed.has(execution.id)) continue;
    const pending = pendingByExecution.get(execution.id) ?? [];
    if (execution.status === 'pending_approval' && pending.length > 0) continue;
    if (execution.status === 'running' && pending.length === 1
      && isExecutionCheckpoint((pending[0]!.payload as { checkpoint?: unknown } | undefined)?.checkpoint)) {
      // The approval checkpoint was durable before the crash; keep it resumable.
      // Mirrors tool-result recovery: markExecutionPending always rewrites the log.
      const { rawLog } = previousLog(store, execution.id);
      store.markExecutionPending(execution.id, 'pending_approval', [...rawLog, {
        at: new Date().toISOString(), level: 'info', code: 'execution_pending_recovered',
        message: '중단된 실행의 승인 대기 상태를 복구했습니다.',
      }]);
      continue;
    }
    rejectPending(execution.id);
    finish(store, execution.id, 'failed', 'interrupted', {
      level: 'warn',
      code: 'interrupted',
      message: '실행 도중 앱이 종료되어 실행을 실패로 정리했습니다. 자동으로 다시 실행하지 않습니다.',
      data: { outcome: 'unknown' },
    }, { keepLog: true });
  }

  // Receipts only stay `processing` while a live run owns them.
  store.deadLetterProcessingTriggerReceipts();
}
