import type { AxCommand, AxCommandResult } from '../../schema.js';
import { httpResponseToTable } from '../../../../../contracts/artifacts/http-response.js';
import { TableArtifactSchema } from '../../../../../contracts/artifacts/table.js';
import { labeledTable, type ColumnLabels } from '../../../../../contracts/artifacts/column-labels.js';
import { hostFacingMessage } from './host-result.js';
import {
  capabilityEnvelopeData,
  httpResponseFromResult,
  rowsForCapabilityTable,
  selectedColumnsFromHttpPath,
  tableForJevTransform,
  uniqueObjectArrayPath,
} from './read-tables.js';
import { shownColumns, tableToMarkdown } from './table-display.js';
import { getCapability } from '../../../../../catalog/data.js';

const SEMANTIC_TRANSFORM_INTENT = /(?:정렬|필터|추천|요약|분석|비교|합계|평균|최대|최소|설명|계산|합산|그룹|묶어|추려|골라|선택|미만|이하|초과|이상|이내|사이|범위|상위|하위|보다\s*(?:크|작|높|낮|많|적)|가장\s*(?:크|작|높|낮|많|적|비싸|저렴)|제외|포함|조건에\s*맞)/iu;

export function needsModelTransform(userMessage: string): boolean {
  return SEMANTIC_TRANSFORM_INTENT.test(userMessage);
}

function fencedBody(body: string, language = 'json'): string {
  const longestFence = Math.max(2, ...[...body.matchAll(/`+/g)].map((match) => match[0].length));
  const fence = '`'.repeat(longestFence + 1);
  return `${fence}${language}\n${body}\n${fence}`;
}

/**
 * Finish an explicit Jev-selected GET without spending a second LLM turn when
 * the request only asks to display the bounded HTTP evidence.
 */
export function deterministicHttpChatReply(
  command: AxCommand,
  result: AxCommandResult,
  userMessage: string,
  jevConfirmedNoTransform = false,
  labels: ColumnLabels = {},
): string | undefined {
  if (command.name !== 'capability.invoke' || command.args.id !== 'http.request') return undefined;
  const params = command.args.params;
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const paramsRecord = params as Record<string, unknown>;
  const rawMethod = paramsRecord.method;
  const method = typeof rawMethod === 'string'
    ? rawMethod.trim().toUpperCase()
    : 'GET';
  if (method !== 'GET' && method !== 'HEAD') return undefined;
  if (result.status !== 'ok') return hostFacingMessage(result, '자료를 가져오지 못했습니다.');

  const parsed = httpResponseFromResult(result);
  if (!parsed.success) return undefined;
  const response = parsed.data;
  const requiresModelTransform = !jevConfirmedNoTransform && needsModelTransform(userMessage);
  if (requiresModelTransform) return undefined;
  // Rows are shown as a table however the request was worded, as for every other read.
  let json: unknown;
  try {
    json = JSON.parse(response.body) as unknown;
  } catch {
    json = undefined;
  }
  if (json !== undefined) {
    const table = httpResponseToTable(response, {
      sourceId: 'http:response',
      rowsPath: uniqueObjectArrayPath(json),
      columns: selectedColumnsFromHttpPath(params),
    });
    if (table.ok) return tableToMarkdown(labeledTable(table.table, labels));
  }

  if (!response.body.trim()) return '가져온 결과가 비어 있습니다.';
  const body = json !== undefined ? JSON.stringify(json, null, 2) : response.body;
  return `가져온 결과:\n\n${fencedBody(boundedRawBody(body), json !== undefined ? 'json' : 'text')}`;
}

/**
 * Complete a Jev-selected read without paying for a second LLM turn when the
 * user only wants bounded data displayed. Semantic transforms still delegate
 * to the model so sorting, filtering, and summaries keep their existing path.
 */
export function deterministicCapabilityReadChatReply(
  command: AxCommand,
  result: AxCommandResult,
  userMessage: string,
  jevConfirmedNoTransform = false,
  labels: ColumnLabels = {},
): string | undefined {
  if (command.name !== 'capability.invoke' || result.status !== 'ok') return undefined;
  const id = command.args.id;
  if (typeof id !== 'string' || id === 'http.request') return undefined;
  if (!jevConfirmedNoTransform && needsModelTransform(userMessage)) return undefined;

  const payload = capabilityEnvelopeData(result);
  // Rows are shown as a table however the request was worded ("주문 목록 보여줘" names no table).
  const table = TableArtifactSchema.safeParse(payload);
  const hidden = typeof id === 'string' ? getCapability(id)?.hiddenColumns ?? [] : [];
  if (table.success) return tableToMarkdown(labeledTable(table.data, labels), shownColumns(table.data, hidden));
  const record = payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as Record<string, unknown>
    : undefined;
  let decoded: unknown = payload;
  if (typeof record?.body === 'string') {
    try { decoded = JSON.parse(record.body) as unknown; } catch { decoded = undefined; }
  }
  // Through the same table as the result pane, so a partial page says it is partial.
  const rowsTable = decoded === undefined || !rowsForCapabilityTable(decoded) ? undefined : tableForJevTransform(command, result);
  if (rowsTable) return tableToMarkdown(labeledTable(rowsTable, labels), shownColumns(rowsTable, hidden));

  if (typeof record?.body === 'string') {
    const body = decoded === undefined ? record.body : JSON.stringify(decoded, null, 2);
    return `가져온 결과:\n\n${fencedBody(boundedRawBody(body), decoded === undefined ? 'text' : 'json')}`;
  }
  const value = record && Object.hasOwn(record, 'result') ? record.result : payload;
  const serialized = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return serialized === undefined
    ? '조회 결과가 비어 있습니다.'
    : `조회 결과:\n\n${fencedBody(boundedRawBody(serialized), typeof value === 'string' ? 'text' : 'json')}`;
}

/** Results that are not rows stay short in the chat; the whole result stays in the run record. */
const MAX_RAW_REPLY_CHARS = 6_000;

function boundedRawBody(body: string): string {
  return body.length <= MAX_RAW_REPLY_CHARS ? body : `${body.slice(0, MAX_RAW_REPLY_CHARS)}\n… (길어서 앞부분만 보여요)`;
}
