import type { ExecutionLogEntry } from '../../connectors/types.js';
import { resolveCapability } from '../../catalog/capability-graph.js';
import type { ExecutionResult } from '../types.js';
import { reportFailureMessage } from '../../documents/reporting/failure-message.js';

const MAX_RESULT_CHARS = 8_000;
const MAX_FIELD_CHARS = 1_200;

const OUTPUT_FIELD_LABELS: Record<string, string> = {
  conclusion: '결론',
  summary: '요약',
  category: '분류',
  riskLevel: '위험도',
  reason: '판단 이유',
};

/** Model confidence (0..1) as a coarse user-facing level; raw numbers read as internals. */
function confidenceLabel(value: unknown): string | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  if (value >= 0.8) return '높음';
  if (value >= 0.5) return '보통';
  return '낮음';
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function safeText(value: unknown, max = MAX_FIELD_CHARS): string | undefined {
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

/** "field.총매출" -> "총매출": the label the example used. */
function resultLabel(outputPath: string): string {
  return outputPath.replace(/^field\./, '').replace(/_/g, ' ').trim() || outputPath;
}

function resultValueText(value: unknown): string | undefined {
  if (value === null || value === undefined) return '(빈 값)';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('ko-KR') : undefined;
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return safeText(value, 200);
}

/** The values a run computed, in step order, one line each ("총매출: 8,466,900"). */
function computedValueLines(log: ExecutionLogEntry[]): string[] {
  const lines: string[] = [];
  for (const entry of log) {
    if (entry.code !== 'transform_value') continue;
    const data = record(entry.data);
    if (!data || typeof data.outputPath !== 'string') continue;
    const text = resultValueText(data.value);
    if (text !== undefined) lines.push(`${resultLabel(data.outputPath)}: ${text}`);
  }
  return lines;
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

  const spreadsheet = [...result.log].reverse().find(entry => entry.code === 'xlsx_generated');
  const file = record(spreadsheet?.data);
  if (result.status === 'success' && file && typeof file.artifactId === 'string'
    && /^art_[a-zA-Z0-9]+$/.test(file.artifactId)) {
    lines.push(`Excel 산출물: table.xlsx (${safeText(file.rowCount, 20) ?? '?'}행)`);
    lines.push(`산출물 ID: ${file.artifactId}`);
    if (file.partial === true) lines.push('현재 표에 있는 행만 저장했습니다. 원본 전체가 아닐 수 있습니다.');
  }
  if (result.status === 'success') {
    const sourceFile = [...result.log].reverse().find((entry) => entry.code === 'sheet_source_resolved');
    const fileName = safeText(record(sourceFile?.data)?.fileName, 200);
    if (fileName) lines.push(`읽은 파일: ${fileName}`);
    lines.push(...computedValueLines(result.log));
  }
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
    const confidence = confidenceLabel(preview.confidence);
    if (confidence) lines.push(`AI 판단 확신도: ${confidence}`);
    if (preview.needMore === true) lines.push('더 많은 자료를 확인해야 정확한 결론을 낼 수 있습니다.');
  }

  if (result.status === 'failed' && result.errorCode) {
    lines.push(...reportFailureMessage(result.log, result.errorCode));
    lines.push(`오류 코드: ${safeText(result.errorCode, 160) ?? 'unknown'}`);
  }
  if (result.status === 'pending_approval' && result.pendingApprovalId) {
    lines.push(
      options.inlineApproval
        ? '대화에서 승인하거나 취소할 수 있습니다.'
        : '승인 요청이 활동에 기록되었습니다.',
    );
  }
  // Only a failed run needs its id in the chat: retrying from where it stopped names it.
  if (result.status === 'failed') lines.push(`실행 ID: ${safeText(result.executionId, 160) ?? 'unknown'}`);
  return lines.join('\n').slice(0, MAX_RESULT_CHARS);
}
