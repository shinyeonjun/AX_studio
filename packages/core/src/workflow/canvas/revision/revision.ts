import type { WorkflowStore } from '../../../store/workflow-store.js';
import { KO } from '../../../i18n/ko.js';

export function explainExecution(store: WorkflowStore, question: string): string {
  const executions = store.listExecutions(20);
  const latest = executions[0];
  if (!latest) return KO.execution.noRecentRuns;

  const q = question.toLowerCase();
  if (q.includes('왜') || q.includes('안') || q.includes('실패')) {
    if (latest.status === 'failed' || latest.errorCode) {
      const code = latest.errorCode ?? 'unknown';
      let detail: string | undefined;
      try {
        const parsed: unknown = JSON.parse(latest.logJson ?? '[]');
        if (!Array.isArray(parsed)) throw new Error('실행 로그가 배열이 아닙니다.');
        detail = (parsed as Array<{ level?: string; message?: string }>).find((l) => l.level === 'error')?.message;
      } catch (error) {
        detail = `실행 로그가 손상되었습니다: ${error instanceof Error ? error.message : String(error)}`;
      }
      return [
        KO.execution.failedAt(latest.startedAt),
        KO.execution.cause(KO.execution.errorMessages[code] ?? code),
        detail ? KO.execution.detail(detail) : '',
        KO.execution.recommendedAction,
      ].filter(Boolean).join('\n');
    }
    return KO.execution.statusAt(latest.startedAt, latest.status);
  }

  return KO.execution.recent(latest.startedAt, latest.status, latest.errorCode);
}
