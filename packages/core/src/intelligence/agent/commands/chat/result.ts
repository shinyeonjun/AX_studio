import type { AgentScopedContextMap } from '../../scoped-context.js';
import {
  AxUiPresentationSchema,
  type AxCommand,
  type AxCommandResult,
  type AxUiPresentation,
} from '../schema.js';
import {
  HttpResponseArtifactSchema,
  httpResponseToTable,
} from '../../../../contracts/artifacts/http-response.js';
import { TableArtifactSchema, type TableArtifact } from '../../../../contracts/artifacts/table.js';
import { tableArtifactFromRows } from '../../../../contracts/artifacts/table-build.js';

export interface CommandChatSessionState {
  workflowId?: string;
  sessionMemo: AgentScopedContextMap;
  workflowPolicy: AgentScopedContextMap;
}

export function presentationFromResult(
  commandName: string,
  result: AxCommandResult,
): AxUiPresentation | undefined {
  if (commandName !== 'ui.present' && commandName !== 'job.propose' && commandName !== 'execution.enqueue_once') {
    return undefined;
  }
  if (commandName === 'ui.present' && result.status !== 'ok') return undefined;
  if (commandName === 'job.propose' && result.status !== 'ok' && result.status !== 'needs_input') return undefined;
  if (commandName === 'execution.enqueue_once' && result.status !== 'needs_input') return undefined;
  const presentationValue =
    result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? (result.data as { presentation?: unknown }).presentation
      : undefined;
  const presentation = AxUiPresentationSchema.safeParse(presentationValue);
  return presentation.success ? presentation.data : undefined;
}

export function hostFacingMessage(result: AxCommandResult, fallback: string): string {
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    const message = (result.data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  const issues = result.issues.map((issue) => issue.message).filter(Boolean);
  if (issues.length > 0) return issues.join(' ');
  return fallback;
}

function httpResponseFromResult(result: AxCommandResult): ReturnType<typeof HttpResponseArtifactSchema.safeParse> {
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    return HttpResponseArtifactSchema.safeParse(undefined);
  }
  const data = result.data as Record<string, unknown>;
  return HttpResponseArtifactSchema.safeParse(
    Object.hasOwn(data, 'data') ? data.data : data,
  );
}

function uniqueObjectArrayPath(value: unknown): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidates = Object.entries(value).filter(([, entry]) =>
    Array.isArray(entry) && entry.every((row) => Boolean(row) && typeof row === 'object' && !Array.isArray(row)),
  );
  return candidates.length === 1 ? candidates[0]?.[0] : undefined;
}

function markdownCell(value: unknown): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value);
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
}

const SEMANTIC_TRANSFORM_INTENT = /(?:정렬|필터|추천|요약|분석|비교|합계|평균|최대|최소|설명|계산|합산|그룹|묶어|추려|골라|선택|미만|이하|초과|이상|이내|사이|범위|상위|하위|보다\s*(?:크|작|높|낮|많|적)|가장\s*(?:크|작|높|낮|많|적|비싸|저렴)|제외|포함|조건에\s*맞)/iu;

function needsModelTransform(userMessage: string): boolean {
  return SEMANTIC_TRANSFORM_INTENT.test(userMessage);
}

export function selectedColumnsFromHttpPath(params: unknown): string[] | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const record = params as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path.trim() : '';
  const queryStart = path.indexOf('?');
  if (queryStart < 0) return undefined;
  const select = new URLSearchParams(path.slice(queryStart + 1).split('#', 1)[0]).get('select');
  if (!select) return undefined;
  const columns = select.split(',').map((column) => column.trim());
  if (columns.length === 0 || columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(column))) {
    return undefined;
  }
  return [...new Set(columns)];
}

function selectAvailableColumns(
  headers: readonly string[],
  requested?: readonly string[],
): string[] {
  const selected = [...new Set(requested ?? [])].filter((header) => headers.includes(header));
  return selected.length > 0 ? selected : [...headers];
}

const MAX_CHAT_TABLE_ROWS = 100;
const MAX_CHAT_TABLE_COLUMNS = 50;

function tableToMarkdown(table: TableArtifact, requestedColumns?: readonly string[]): string {
  const allHeaders = selectAvailableColumns(
    table.columns.map((column) => column.name),
    requestedColumns,
  );
  const headers = allHeaders.slice(0, MAX_CHAT_TABLE_COLUMNS);
  const rows = table.rows.slice(0, MAX_CHAT_TABLE_ROWS);
  if (headers.length === 0) return '조회 결과가 비어 있습니다.';
  const lines = [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((row) => `| ${headers.map((header) => markdownCell(row.values[header])).join(' | ')} |`),
  ];
  if (headers.length < allHeaders.length) {
    lines.push('', `화면에는 전체 ${allHeaders.length}열 중 처음 ${headers.length}열만 표시했습니다.`);
  }
  if (rows.length < table.rows.length) {
    lines.push('', `화면에는 전체 ${table.rows.length}행 중 처음 ${rows.length}행만 표시했습니다.`);
  }
  if (table.truncated || table.completeness?.status !== 'complete') {
    lines.push('', '응답이 일부만 포함되어 있습니다.');
  }
  return lines.join('\n');
}

export function formatTableArtifact(table: TableArtifact): string {
  return tableToMarkdown(table);
}

/** Keep only the bounded, visible table needed for an immediate follow-up. */
export function boundedChatReadResult(table: TableArtifact): TableArtifact | undefined {
  const columns = table.columns.slice(0, MAX_CHAT_TABLE_COLUMNS);
  const names = columns.map(({ name }) => name);
  const rows = table.rows.slice(0, MAX_CHAT_TABLE_ROWS).map((row) => ({
    ...row,
    values: Object.fromEntries(names.flatMap((name) =>
      Object.hasOwn(row.values, name) ? [[name, row.values[name]]] : [],
    )),
  }));
  const bounded: TableArtifact = {
    id: table.id,
    kind: 'table',
    ...(table.name ? { name: table.name } : {}),
    columns,
    rows,
    truncated: table.truncated || columns.length < table.columns.length || rows.length < table.rows.length,
    ...(table.completeness ? { completeness: table.completeness } : {}),
  };
  return new TextEncoder().encode(JSON.stringify(bounded)).byteLength <= 64_000 ? bounded : undefined;
}

function httpTableForTransform(command: AxCommand, result: AxCommandResult): TableArtifact | undefined {
  const parsed = httpResponseFromResult(result);
  if (!parsed.success) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(parsed.data.body) as unknown;
  } catch {
    return undefined;
  }
  const params = command.args.params;
  const converted = httpResponseToTable(parsed.data, {
    sourceId: 'http:response',
    rowsPath: uniqueObjectArrayPath(json),
    columns: selectedColumnsFromHttpPath(params),
  });
  return converted.ok ? converted.table : undefined;
}

export function tableForJevTransform(command: AxCommand, result: AxCommandResult): TableArtifact | undefined {
  if (command.name !== 'capability.invoke' || result.status !== 'ok') return undefined;
  if (command.args.id === 'http.request') return httpTableForTransform(command, result);

  let payload = capabilityEnvelopeData(result);
  const table = TableArtifactSchema.safeParse(payload);
  if (table.success) return table.data;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const body = (payload as Record<string, unknown>).body;
    if (typeof body === 'string') {
      try { payload = JSON.parse(body) as unknown; } catch { return undefined; }
    }
  }
  const rows = rowsForCapabilityTable(payload);
  return rows ? tableArtifactFromRows(rows, { id: 'chat:capability-result' }) : undefined;
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

function capabilityEnvelopeData(result: AxCommandResult): unknown {
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return result.data;
  const envelope = result.data as Record<string, unknown>;
  return Object.hasOwn(envelope, 'data') ? envelope.data : envelope;
}

function objectRows(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.every((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    ? value as Record<string, unknown>[]
    : undefined;
}

function rowsForCapabilityTable(value: unknown): Record<string, unknown>[] | undefined {
  const direct = objectRows(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const candidates = Object.values(value).filter((entry) => objectRows(entry));
  return candidates.length === 1 ? objectRows(candidates[0]) : undefined;
}

function rowsToMarkdown(rows: Record<string, unknown>[]): string {
  const headerSet = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      headerSet.add(key);
      if (headerSet.size > MAX_CHAT_TABLE_COLUMNS) break;
    }
    if (headerSet.size > MAX_CHAT_TABLE_COLUMNS) break;
  }
  const allHeaders = [...headerSet];
  const headers = allHeaders.slice(0, MAX_CHAT_TABLE_COLUMNS);
  const displayedRows = rows.slice(0, MAX_CHAT_TABLE_ROWS);
  if (headers.length === 0) return '조회 결과가 비어 있습니다.';
  const lines = [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...displayedRows.map((row) => `| ${headers.map((header) => markdownCell(row[header])).join(' | ')} |`),
  ];
  if (allHeaders.length > headers.length) {
    lines.push('', `열이 많아 화면에는 처음 ${headers.length}열만 표시했습니다.`);
  }
  if (rows.length > displayedRows.length) {
    lines.push('', `화면에는 전체 ${rows.length}행 중 처음 ${displayedRows.length}행만 표시했습니다.`);
  }
  return lines.join('\n');
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

export function deterministicWorkflowListChatReply(
  command: AxCommand,
  result: AxCommandResult,
  userMessage: string,
): string | undefined {
  if (command.name !== 'workflow.list' || result.command !== 'workflow.list' || result.status !== 'ok') return undefined;
  if (needsModelTransform(userMessage)) return undefined;
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return undefined;
  const workflows = (result.data as { workflows?: unknown }).workflows;
  if (!Array.isArray(workflows)) return undefined;
  if (workflows.length === 0) return '저장된 workflow가 없습니다.';
  if (!workflows.every((workflow) => workflow && typeof workflow === 'object' && !Array.isArray(workflow)
    && typeof workflow.id === 'string'
    && typeof workflow.name === 'string'
    && typeof workflow.active === 'boolean'
    && Number.isSafeInteger(workflow.latestVersion))) return undefined;

  return [
    `저장된 workflow (${workflows.length}개):`,
    ...workflows.map((workflow) => {
      const entry = workflow as { id: string; name: string; active: boolean; latestVersion: number };
      return `- ${JSON.stringify(entry.name)} — ${entry.active ? '활성' : '비활성'}, v${entry.latestVersion} (ID: ${JSON.stringify(entry.id)})`;
    }),
  ].join('\n');
}

// Skip prose generation only for explicit catalog display; interpretation stays on the model path.
const DETERMINISTIC_METADATA_COMMANDS: ReadonlySet<AxCommand['name']> = new Set([
  'resource.list',
  'source.list',
  'source.files.list',
  'session.source.list',
  'capability.list',
  'capability.describe',
  'discovery.search',
  'discovery.describe',
]);
const METADATA_DISPLAY_INTENT = /(?:목록|리스트|보여|나열|그대로|원본|조회해|확인해|알려줘|찾아줘|검색해|\b(?:list|show|display|find|search|lookup)\b)/iu;

export function deterministicHttpConnectionListChatReply(
  command: AxCommand,
  result: AxCommandResult,
  userMessage: string,
): string | undefined {
  if (command.name !== 'http.list'
    || result.command !== command.name
    || result.status !== 'ok'
    || !METADATA_DISPLAY_INTENT.test(userMessage)
    || needsModelTransform(userMessage)
    || !result.data
    || typeof result.data !== 'object'
    || Array.isArray(result.data)) return undefined;

  const data = result.data as { connections?: unknown; count?: unknown; totalMatches?: unknown; truncated?: unknown };
  if (!Array.isArray(data.connections)
    || !data.connections.every((connection) => connection && typeof connection === 'object'
      && !Array.isArray(connection)
      && typeof connection.id === 'string'
      && typeof connection.label === 'string'
      && typeof connection.connected === 'boolean'
      && typeof connection.usable === 'boolean')) return undefined;
  if (data.connections.length === 0) {
    return typeof data.count === 'number' && data.count > 0
      ? '조건에 맞는 HTTP 연결이 없습니다.'
      : '저장된 HTTP 연결이 없습니다.';
  }

  const connections = data.connections as { id: string; label: string; connected: boolean; usable: boolean }[];
  const total = Number.isSafeInteger(data.totalMatches) ? data.totalMatches as number : connections.length;
  return [
    `저장된 HTTP 연결 (${connections.length}/${total}개):`,
    ...connections.map((connection) =>
      `- ${JSON.stringify(connection.label)} (ID: ${JSON.stringify(connection.id)}) — ${connection.usable ? '사용 가능' : connection.connected ? '인증 설정 필요' : '연결 끊김'}`),
    ...(data.truncated === true ? ['', '목록이 일부만 표시되었습니다.'] : []),
  ].join('\n');
}

export function deterministicMetadataChatReply(
  command: AxCommand,
  result: AxCommandResult,
  userMessage: string,
): string | undefined {
  if (!DETERMINISTIC_METADATA_COMMANDS.has(command.name)
    || result.command !== command.name
    || result.status !== 'ok'
    || result.data === undefined
    || needsModelTransform(userMessage)
    || !METADATA_DISPLAY_INTENT.test(userMessage)) return undefined;

  try {
    const serialized = JSON.stringify(result.data, null, 2);
    return serialized === undefined
      ? undefined
      : `조회 결과:\n\n${fencedBody(serialized)}`;
  } catch {
    return undefined;
  }
}

export function applyCommandResultToSession(
  commandName: string,
  result: AxCommandResult,
  session: CommandChatSessionState,
): void {
  if (result.status !== 'ok' || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return;
  const data = result.data as { workflowId?: unknown; scope?: unknown; context?: unknown };
  if (commandName === 'workflow.create' || commandName === 'workflow.update' || commandName === 'job.commit') {
    if (typeof data.workflowId === 'string' && data.workflowId.trim()) session.workflowId = data.workflowId.trim();
  }
  if (commandName === 'workflow.delete' && data.workflowId === session.workflowId) {
    session.workflowId = undefined;
    session.workflowPolicy = {};
  }
  if (commandName === 'context.update' && data.context && typeof data.context === 'object' && !Array.isArray(data.context)) {
    if (data.scope === 'session') session.sessionMemo = data.context as AgentScopedContextMap;
    if (data.scope === 'workflow') session.workflowPolicy = data.context as AgentScopedContextMap;
  }
}
