import type { AgentHarness } from '../../../harness.js';
import type { TableArtifact } from '../../../../../contracts/artifacts/table.js';
import { needsColumnLabel, validColumnLabel, type ColumnLabels } from '../../../../../contracts/artifacts/column-labels.js';
import { appendAppLog } from '../../../../../persistence/paths/app-log.js';

/** Where learned headers live (the host's settings); shared with run results. */
export interface ColumnLabelMemory {
  known(): ColumnLabels;
  remember(labels: ColumnLabels): void;
}

const MAX_COLUMNS_PER_ASK = 40;
const LABEL_TIMEOUT_MS = 20_000;

const SYSTEM_PROMPT = [
  '데이터 표의 열 이름을 업무 담당자가 바로 이해할 짧은 한국어 머리글로 바꾼다.',
  '- 입력: {"columns":[{"name":"열 이름","type":"자료형"}]}',
  '- 출력: {"열 이름":"한국어 머리글"} JSON 객체 하나만. 설명, 코드 블록 금지.',
  '- 머리글은 2~12자 안팎. 예: total_amount → 총 금액, created_at → 생성일, customer.name → 고객 이름.',
  '- 브랜드·제품명·약어(ID, URL, SKU)는 그대로 두되 뜻이 있으면 함께 쓴다. 예: sku → SKU, user_id → 사용자 ID.',
  '- 다른 열 이름과 자료형을 보고 뜻을 정한다. 뜻을 알 수 없는 열은 출력에서 뺀다.',
].join('\n');

function parseLabels(output: string, asked: readonly string[]): ColumnLabels {
  const start = output.indexOf('{');
  const end = output.lastIndexOf('}');
  if (start < 0 || end <= start) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(output.slice(start, end + 1)) as unknown;
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
  const record = parsed as Record<string, unknown>;
  return Object.fromEntries(asked.flatMap((name) => validColumnLabel(record[name]) ? [[name, (record[name] as string).trim()]] : []));
}

/**
 * Korean headers for a table about to be shown: the ones already learned, plus, for column names
 * seen for the first time, one ask to the person's AI. Only names and types are sent, never cell
 * values. What it answers is remembered, so each column name costs one ask ever. Any failure leaves
 * the raw name.
 */
export async function columnLabelsFor(table: TableArtifact, input: {
  memory?: ColumnLabelMemory;
  harness: Pick<AgentHarness, 'runText'>;
  requestId?: string;
  signal?: AbortSignal;
}): Promise<ColumnLabels> {
  if (!input.memory) return {};
  const known = input.memory.known();
  const missing = [...new Set(table.columns.map((column) => column.name))]
    .filter((name) => needsColumnLabel(name) && !known[name] && !table.columns.find((column) => column.name === name)?.label)
    .slice(0, MAX_COLUMNS_PER_ASK);
  if (missing.length === 0) return known;
  const startedAt = Date.now();
  try {
    const timeout = AbortSignal.timeout(LABEL_TIMEOUT_MS);
    const reply = await input.harness.runText({
      requestId: input.requestId ? `${input.requestId}:column-labels` : undefined,
      role: 'command',
      systemPrompt: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify({ columns: missing.map((name) => ({ name, type: table.columns.find((column) => column.name === name)?.type ?? 'unknown' })) }) }],
      logContext: 'column_labels',
      abortSignal: input.signal ? AbortSignal.any([input.signal, timeout]) : timeout,
    });
    const learned = parseLabels(reply.output, missing);
    input.memory.remember(learned);
    appendAppLog('info', 'Column headers labelled in Korean.', {
      requestId: input.requestId, event: 'chat_column_labels', asked: missing.length, labelled: Object.keys(learned).length, durationMs: Date.now() - startedAt,
    });
    return { ...known, ...learned };
  } catch (error) {
    input.signal?.throwIfAborted();
    appendAppLog('warn', 'Column headers kept as named; labelling failed.', {
      requestId: input.requestId, event: 'chat_column_labels_failed', asked: missing.length, error: error instanceof Error ? error.message : String(error),
    });
    return known;
  }
}
