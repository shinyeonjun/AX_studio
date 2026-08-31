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
}

const STEP_PROGRESS_CODES = new Set(['step_started', 'step_completed', 'waiting_approval', 'step_failed']);

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

export function executionLogSummary(logJson: string | null): ExecutionLogSummary {
  if (!logJson) return {};
  try {
    const parsed = JSON.parse(logJson) as unknown;
    if (!Array.isArray(parsed)) return {};
    const entries = parsed.filter(
      (entry): entry is PersistedExecutionLogEntry => Boolean(entry && typeof entry === 'object'),
    );
    const last = entries.at(-1);
    const errorMessage = entries.filter((entry) => entry.level === 'error').at(-1)?.message;
    const current = [...entries].reverse().find((entry) => STEP_PROGRESS_CODES.has(entry.code ?? ''));
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
    return {
      ...(errorMessage ? { errorMessage } : {}),
      ...(stepId && current?.code ? { currentStepId: stepId, currentStepStatus: current.code } : {}),
      ...(current?.message ? { currentStepMessage: current.message } : {}),
      ...(last?.message ? { lastLogMessage: last.message } : {}),
      ...(aiStepId ? { aiOutput: { stepId: aiStepId, fields: aiFields, preview: aiPreview } } : {}),
      ...(generatedPdf ? { generatedPdf } : {}),
    };
  } catch {
    return {};
  }
}
