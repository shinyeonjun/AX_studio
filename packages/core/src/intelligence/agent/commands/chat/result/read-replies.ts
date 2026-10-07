import type { AxCommand, AxCommandResult } from '../../schema.js';
import { httpResponseToTable } from '../../../../../contracts/artifacts/http-response.js';
import { TableArtifactSchema } from '../../../../../contracts/artifacts/table.js';
import { hostFacingMessage } from './host-result.js';
import {
  capabilityEnvelopeData,
  httpResponseFromResult,
  rowsForCapabilityTable,
  selectedColumnsFromHttpPath,
  uniqueObjectArrayPath,
} from './read-tables.js';
import { rowsToMarkdown, tableToMarkdown } from './table-display.js';

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
  if (result.status !== 'ok') return hostFacingMessage(result, 'HTTP 조회를 처리하지 못했습니다.');

  const parsed = httpResponseFromResult(result);
  if (!parsed.success) return undefined;
  const response = parsed.data;
  const wantsTable = /표|테이블|table|열|컬럼/iu.test(userMessage);
  const requiresModelTransform = !jevConfirmedNoTransform && needsModelTransform(userMessage);
  if (requiresModelTransform) return undefined;
  if (wantsTable) {
    let json: unknown;
    try {
      json = JSON.parse(response.body) as unknown;
    } catch {
      return undefined;
    }
    const table = httpResponseToTable(response, {
      sourceId: 'http:response',
      rowsPath: uniqueObjectArrayPath(json),
      columns: selectedColumnsFromHttpPath(params),
    });
    return table.ok ? tableToMarkdown(table.table) : undefined;
  }

  if (!response.body.trim()) return `HTTP ${response.status} 응답이 비어 있습니다.`;
  let body = response.body;
  let language = 'text';
  if (response.contentType?.toLowerCase().includes('json')) {
    try {
      body = JSON.stringify(JSON.parse(response.body) as unknown, null, 2);
      language = 'json';
    } catch {
      // Preserve a non-JSON provider body as text.
    }
  }
  return `HTTP ${response.status} 조회 결과:\n\n${fencedBody(body, language)}`;
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
): string | undefined {
  if (command.name !== 'capability.invoke' || result.status !== 'ok') return undefined;
  const id = command.args.id;
  if (typeof id !== 'string' || id === 'http.request') return undefined;
  if (!jevConfirmedNoTransform && needsModelTransform(userMessage)) return undefined;

  const payload = capabilityEnvelopeData(result);
  const wantsTable = /표|테이블|table|열|컬럼/iu.test(userMessage);
  if (wantsTable) {
    const table = TableArtifactSchema.safeParse(payload);
    if (table.success) return tableToMarkdown(table.data);
    let decoded = payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const body = (payload as Record<string, unknown>).body;
      if (typeof body === 'string') {
        try { decoded = JSON.parse(body) as unknown; } catch { return undefined; }
      }
    }
    const rows = rowsForCapabilityTable(decoded);
    return rows ? rowsToMarkdown(rows) : undefined;
  }

  let body = payload;
  let language = 'json';
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.body === 'string') {
      body = record.body;
      language = 'text';
      try {
        body = JSON.stringify(JSON.parse(record.body) as unknown, null, 2);
        language = 'json';
      } catch {
        // Preserve a non-JSON provider body as text.
      }
      const status = typeof record.status === 'number' ? ` (HTTP ${record.status})` : '';
      return `조회 결과${status}:\n\n${fencedBody(String(body ?? ''), language)}`;
    }
    if (Object.hasOwn(record, 'result')) body = record.result;
  }
  const serialized = typeof body === 'string' ? body : JSON.stringify(body, null, 2);
  return serialized === undefined
    ? '조회 결과가 비어 있습니다.'
    : `조회 결과:\n\n${fencedBody(serialized, typeof body === 'string' ? 'text' : 'json')}`;
}
