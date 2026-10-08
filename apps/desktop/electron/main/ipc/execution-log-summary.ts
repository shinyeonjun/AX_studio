import { connectorErrorMessage, executionErrorReason } from '@ax-studio/core';

type PersistedExecutionLogEntry = {
  at?: string;
  level?: 'info' | 'warn' | 'error';
  code?: string;
  message?: string;
  data?: unknown;
};

export interface GeneratedPdfSummary {
  artifactId: string;
  fileName: string;
  size: number;
  mimeType: 'application/pdf';
}

export interface ExecutionLogSummary {
  errorMessage?: string;
  currentStepId?: string;
  currentStepStatus?: string;
  currentStepMessage?: string;
  lastLogMessage?: string;
  aiOutput?: {
    stepId: string;
    fields: string[];
    preview: Record<string, string>;
  };
  generatedPdf?: GeneratedPdfSummary;
  /** The file a "newest file" read actually opened this run. */
  sourceFile?: string;
  /** What the run computed, in step order: values and the visible part of tables. */
  computedResults?: ComputedResult[];
}

export type ComputedResult =
  | { kind: 'value'; label: string; value: string }
  | { kind: 'table'; label: string; columns: string[]; rows: string[][]; totalRows: number };

const MAX_COMPUTED_RESULTS = 20;
const MAX_RESULT_TABLE_ROWS = 20;

/** "field.총매출" -> "총매출": the label the example used. */
function resultLabel(outputPath: unknown): string {
  const path = typeof outputPath === 'string' ? outputPath : '';
  return path.replace(/^field\./, '').replace(/_/g, ' ').trim() || '결과';
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value.toLocaleString('ko-KR') : '';
  if (typeof value === 'boolean') return value ? '예' : '아니오';
  return String(value).slice(0, 200);
}

function computedResult(entry: PersistedExecutionLogEntry): ComputedResult | undefined {
  const data = record(entry.data);
  if (!data) return undefined;
  if (entry.code === 'transform_value') {
    return { kind: 'value', label: resultLabel(data.outputPath), value: cellText(data.value) || '(빈 값)' };
  }
  const table = record(data.table);
  if (entry.code !== 'transform_table' || !table || !Array.isArray(table.columns) || !Array.isArray(table.rows)) return undefined;
  const columns = table.columns
    .map((column) => (typeof column === 'string' ? column : String(record(column)?.name ?? '')))
    .filter(Boolean);
  const rows = table.rows.slice(0, MAX_RESULT_TABLE_ROWS).map((row) => {
    const values = record(record(row)?.values) ?? record(row) ?? {};
    return columns.map((column) => cellText(Object.hasOwn(values, column) ? values[column] : undefined));
  });
  return { kind: 'table', label: resultLabel(data.outputPath), columns, rows, totalRows: table.rows.length };
}

const HANGUL = /[가-힣]/u;
const GENERIC_FAILURE = connectorErrorMessage(undefined);

/**
 * A log line as the activity list may show it. Log messages are written for engineers too
 * (codes such as `http.request_failed`, English exception text, step ids), so only Korean
 * reaches the screen: failures are translated, anything else unreadable is left out.
 */
function readableLogMessage(entry: PersistedExecutionLogEntry | undefined): string | undefined {
  if (!entry) return undefined;
  // "AI 분석 완료: <step id>" carries an internal id.
  if (entry.code === 'ai_decision_completed') return 'AI 분석을 마쳤습니다.';
  const message = entry.message?.trim();
  if (message && HANGUL.test(message)) return message;
  if (entry.level !== 'error' && entry.code !== 'step_failed') return undefined;
  const translated = message ? connectorErrorMessage(message) : undefined;
  if (translated && translated !== GENERIC_FAILURE && HANGUL.test(translated)) return translated;
  return executionErrorReason(entry.code) ?? GENERIC_FAILURE;
}

const STEP_PROGRESS_CODES = new Set(['step_started', 'step_completed', 'waiting_approval', 'step_failed', 'approval_rejected']);

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function safePdfFileName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const leaf = value.replace(/^.*[\\/]/, '');
  const sanitized = leaf
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 180);
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : undefined;
}

function generatedPdfSummary(data: unknown): GeneratedPdfSummary | undefined {
  const entry = record(data);
  if (!entry) return undefined;
  const artifactId = typeof entry.artifactId === 'string' ? entry.artifactId.trim() : '';
  const fileName = safePdfFileName(entry.fileName);
  const size = entry.size;
  const mimeType = entry.mimeType;
  if (
    !artifactId ||
    artifactId === '.' ||
    artifactId === '..' ||
    artifactId.includes('/') ||
    artifactId.includes('\\') ||
    !fileName ||
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    mimeType !== 'application/pdf'
  ) {
    return undefined;
  }
  return { artifactId, fileName, size, mimeType };
}

export function executionLogSummary(logJson: string | null, executionStatus?: string): ExecutionLogSummary {
  if (!logJson) return {};
  try {
    const parsed = JSON.parse(logJson) as unknown;
    if (!Array.isArray(parsed)) return {};
    const entries = parsed.filter(
      (entry): entry is PersistedExecutionLogEntry => Boolean(entry && typeof entry === 'object'),
    );
    const last = entries.at(-1);
    const errorMessage = readableLogMessage(entries.filter((entry) => entry.level === 'error').at(-1));
    let current = [...entries].reverse().find((entry) => STEP_PROGRESS_CODES.has(entry.code ?? ''));
    if (current?.code === 'waiting_approval' && ['success', 'failed', 'cancelled'].includes(executionStatus ?? '')) {
      current = undefined;
    }
    const aiCompleted = [...entries].reverse().find((entry) => entry.code === 'ai_decision_completed');
    const currentData = record(current?.data);
    const stepId = typeof currentData?.stepId === 'string' ? currentData.stepId : undefined;
    const aiRecord = record(aiCompleted?.data);
    const aiStepId = typeof aiRecord?.stepId === 'string' ? aiRecord.stepId : undefined;
    const aiFields = Array.isArray(aiRecord?.outputFields)
      ? aiRecord.outputFields.filter((field): field is string => typeof field === 'string')
      : [];
    const aiPreviewRecord = record(aiRecord?.outputPreview);
    const aiPreview = aiPreviewRecord
      ? Object.fromEntries(
          Object.entries(aiPreviewRecord).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
      : {};
    const pdfGenerated = [...entries].reverse().find((entry) => entry.code === 'pdf_generated');
    const generatedPdf = generatedPdfSummary(pdfGenerated?.data);
    const resolvedSource = record([...entries].reverse().find((entry) => entry.code === 'sheet_source_resolved')?.data);
    const sourceFile = typeof resolvedSource?.fileName === 'string' ? resolvedSource.fileName.slice(0, 200) : undefined;
    const computedResults = executionStatus === 'success'
      ? entries.flatMap((entry) => computedResult(entry) ?? []).slice(0, MAX_COMPUTED_RESULTS)
      : [];
    const currentStepMessage = readableLogMessage(current);
    const lastLogMessage = readableLogMessage(last);
    return {
      ...(errorMessage ? { errorMessage } : {}),
      ...(stepId && current?.code ? { currentStepId: stepId, currentStepStatus: current.code } : {}),
      ...(currentStepMessage ? { currentStepMessage } : {}),
      ...(lastLogMessage ? { lastLogMessage } : {}),
      ...(aiStepId ? { aiOutput: { stepId: aiStepId, fields: aiFields, preview: aiPreview } } : {}),
      ...(generatedPdf ? { generatedPdf } : {}),
      ...(sourceFile ? { sourceFile } : {}),
      ...(computedResults.length > 0 ? { computedResults } : {}),
    };
  } catch {
    return {};
  }
}
