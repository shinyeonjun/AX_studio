import type { WorkflowStore } from '../../../persistence/workflow-store.js';
import { KO } from '../../../i18n/ko.js';

type ExecutionView = ReturnType<WorkflowStore['listExecutions']>[number];

const FAILURE_QUESTION = /왜|이유|원인|실패|오류|에러|멈췄|멈춘|안\s?(됐|돼|되|된)|못\s?했/;

const STATUS_LABELS: Record<string, string> = {
  success: '성공',
  failed: '실패',
  running: '실행 중',
  pending_approval: '승인 대기',
  cancelled: '취소됨',
};

const TRIGGER_LABELS: Record<string, string> = {
  manual: '수동 실행',
  schedule: '일정 실행',
  once: '예약 실행',
  'gmail.new_message': 'Gmail 새 메일',
  'slack.new_message': 'Slack 새 메시지',
  'webhook.inbound': 'Webhook 수신',
  'local_folder.new_file': '폴더 새 파일',
};

function formatStartedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ko-KR', {
    month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** Workflow name and step labels from the stored IR snapshot; empty when absent or unreadable. */
function irSummary(irJson: string | undefined): { name?: string; steps: string[] } {
  if (!irJson) return { steps: [] };
  try {
    const ir = JSON.parse(irJson) as { name?: unknown; steps?: unknown };
    const steps = Array.isArray(ir.steps)
      ? ir.steps.flatMap((step: { type?: unknown; id?: unknown; connector?: unknown; action?: unknown }) => {
        if (step?.type === 'action' && typeof step.connector === 'string' && typeof step.action === 'string') {
          return [`${step.connector}.${step.action}`];
        }
        return typeof step?.id === 'string' ? [step.id] : [];
      })
      : [];
    return { name: typeof ir.name === 'string' && ir.name.trim() ? ir.name.trim() : undefined, steps };
  } catch {
    return { steps: [] };
  }
}

function failureLines(latest: ExecutionView): string[] {
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
    KO.execution.failedAt(formatStartedAt(latest.startedAt)),
    KO.execution.cause(KO.execution.errorMessages[code] ?? code),
    detail ? KO.execution.detail(detail) : '',
    KO.execution.recommendedAction,
  ].filter(Boolean);
}

/**
 * Deterministic answer about the most recent run (no model call). Failure questions get the
 * cause and log detail; anything else gets a readable summary of what ran and how it ended.
 */
export function explainExecution(store: WorkflowStore, question: string): string {
  const latest = store.listExecutions(20)[0];
  if (!latest) return KO.execution.noRecentRuns;

  const failed = latest.status === 'failed' || Boolean(latest.errorCode);
  if (FAILURE_QUESTION.test(question) && failed) return failureLines(latest).join('\n');

  const { name, steps } = irSummary(latest.irJson);
  const trigger = latest.triggerType ? TRIGGER_LABELS[latest.triggerType] ?? latest.triggerType : undefined;
  const subject = name ? `「${name}」` : latest.ephemeral ? '일회 실행' : '업무';
  const lines = [
    `가장 최근 실행은 ${formatStartedAt(latest.startedAt)}에 시작한 ${subject}${trigger ? `(${trigger})` : ''}이며, 상태는 ${statusLabel(latest.status)}입니다.`,
    steps.length > 0 ? `실행 단계: ${steps.join(' → ')}` : '',
    failed ? KO.execution.cause(KO.execution.errorMessages[latest.errorCode ?? ''] ?? latest.errorCode ?? 'unknown') : '',
    failed ? '실패 이유를 자세히 보려면 "왜 실패했어?"라고 물어보세요.' : '',
  ];
  return lines.filter(Boolean).join('\n');
}
