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
import type { TableArtifact } from '../../../../contracts/artifacts/table.js';

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

function tableToMarkdown(table: TableArtifact): string {
  const headers = table.columns.map((column) => column.name);
  if (headers.length === 0) return '조회 결과가 비어 있습니다.';
  const lines = [
    `| ${headers.map(markdownCell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...table.rows.map((row) => `| ${headers.map((header) => markdownCell(row.values[header])).join(' | ')} |`),
  ];
  if (table.truncated || table.completeness?.status !== 'complete') {
    lines.push('', '응답이 일부만 포함되어 있습니다.');
  }
  return lines.join('\n');
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
  const needsModelTransform = /정렬|필터|추천|요약|분석|비교|합계|평균|최대|최소|설명/iu.test(userMessage);
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
    });
    return table.ok ? tableToMarkdown(table.table) : undefined;
  }
  if (needsModelTransform) return undefined;

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
