import type { SourceListingConnection } from '../../../../connectors/types.js';
import { parseMcpConnectionConfig } from '../../../../connectors/protocols/mcp/index.js';
import {
  parseOpenApiConnectionConfig,
  parseOpenApiSpec,
  type OpenApiOperation,
  type OpenApiParameter,
} from '../../../../connectors/protocols/openapi/index.js';
import { requestLimitValue } from './request-features.js';

export const JEV_READ_OPERATION_MAX_HINTS = 64;
const MAX_TEXT_CHARS = 320;
const MAX_EXPLICIT_PARAMETER_CHARS = 500;
const NATURAL_LIMIT_PARAMETER_NAMES = new Set([
  'count',
  'limit',
  'pagesize',
  'perpage',
  'per_page',
  'size',
  'top',
]);
const SENSITIVE_PARAMETER_NAME = /(?:api[_-]?key|authorization|password|secret|token)/iu;

/**
 * A safe, local mapping from a Jev choice to a host-owned read command.
 *
 * `params` never enters Jev state. It is retained only so the host can turn a
 * selected bounded key into a typed capability.invoke command.
 */
export interface JevReadOperationHint {
  key: string;
  capabilityId: string;
  connector: 'openapi' | 'mcp' | 'rdb';
  sourceLabel?: string;
  label: string;
  description: string;
  params: Record<string, unknown>;
  /** Safe parameter paths that a single bounded LLM fill turn may supply. */
  parameterHints?: readonly JevReadParameterHint[];
  /** Required paths still absent from the host-resolved params. */
  missingParameterPaths?: readonly string[];
}

export interface JevReadParameterHint {
  path: string;
  type?: string;
  required: boolean;
}

const OPERATION_QUERY_STOP_WORDS = new Set([
  'api', 'http', 'rest', 'endpoint', 'json', 'database', 'db', 'sql', 'get', 'head',
  '조회', '검색', '읽기', '읽어', '가져', '가져와', '호출', '요청', '실행', '보여', '보여줘',
  '목록', '데이터', '자료', '정보', '테이블', '해줘', '해주세요', '부탁', '부탁해',
]);
const KOREAN_REQUEST_SUFFIX = /(?:해주세요|해줘|해봐|할래|할까|으로|에서|에게|부터|까지|을|를|이|가|은|는|에|로|와|과|도|만|의|랑|이나|나|해|줘)$/u;

function operationQueryTokens(message: string): string[] {
  return [...message.toLocaleLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)]
    .map(([token]) => token.replace(KOREAN_REQUEST_SUFFIX, ''))
    .filter((token) => token.length >= 2 && !/^\d+$/u.test(token) && !OPERATION_QUERY_STOP_WORDS.has(token));
}

/**
 * Keeps bounded catalogs useful when the host has already reached the Jev
 * choice budget. An unrelated prefix is worse than asking discovery to find
 * the operation, so an exhausted catalog with no lexical evidence is closed.
 */
export function selectJevReadOperationHints(
  hints: readonly JevReadOperationHint[],
  userMessage: string,
): readonly JevReadOperationHint[] {
  const bounded = hints.slice(0, JEV_READ_OPERATION_MAX_HINTS);
  if (hints.length < JEV_READ_OPERATION_MAX_HINTS) return bounded;

  const tokens = operationQueryTokens(userMessage);
  if (tokens.length === 0) return [];
  return bounded
    .map((hint, index) => {
      const text = [hint.sourceLabel, hint.label, hint.description, hint.capabilityId]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      const score = tokens.reduce((total, token) => total + (text.includes(token) ? 1 : 0), 0);
      return { hint, index, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.hint);
}

function text(value: unknown, maxChars = MAX_TEXT_CHARS): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxChars) : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function explicitParameterValue(message: string, name: string): string | undefined {
  const pattern = new RegExp(`(?:^|[?&\\s])${escapeRegExp(name)}\\s*[=:]\\s*([^\\s&"'<>]+)`, 'iu');
  const value = message.match(pattern)?.[1];
  return value && value.length <= MAX_EXPLICIT_PARAMETER_CHARS ? value : undefined;
}

function parameterValue(
  message: string,
  parameter: OpenApiParameter,
  naturalLimit: number | undefined,
): string | number | boolean | undefined {
  if (parameter.in === 'header' || parameter.in === 'cookie' || SENSITIVE_PARAMETER_NAME.test(parameter.name)) {
    return undefined;
  }
  const raw = explicitParameterValue(message, parameter.name)
    ?? (parameter.in === 'query' && NATURAL_LIMIT_PARAMETER_NAMES.has(parameter.name.toLowerCase()) && naturalLimit !== undefined
      ? String(naturalLimit)
      : undefined);
  if (raw === undefined) return undefined;
  if (parameter.type === 'integer' || parameter.type === 'number') {
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  if (parameter.type === 'boolean') {
    if (/^(?:true|yes|예|맞아)$/iu.test(raw)) return true;
    if (/^(?:false|no|아니)$/iu.test(raw)) return false;
    return undefined;
  }
  return raw;
}

interface OpenApiParamResolution {
  params: Record<string, unknown>;
  parameterHints: JevReadParameterHint[];
  missingParameterPaths: string[];
}

function openApiParams(
  operation: OpenApiOperation,
  userMessage: string,
): OpenApiParamResolution | undefined {
  // Auth headers and request bodies are intentionally not guessed from chat.
  // They need an explicit typed flow so a read route cannot smuggle secrets or
  // an unbounded payload into a provider call.
  if (operation.securityRequired || operation.requestBody?.required) return undefined;

  const naturalLimit = requestLimitValue(userMessage);
  const groups: Record<string, Record<string, unknown>> = {};
  const parameterHints: JevReadParameterHint[] = [];
  const missingParameterPaths: string[] = [];
  const groupFor = {
    path: 'pathParams',
    query: 'query',
    header: 'headers',
    cookie: 'cookies',
  } as const;
  for (const parameter of operation.parameters ?? []) {
    if (SENSITIVE_PARAMETER_NAME.test(parameter.name)) {
      if (parameter.required) return undefined;
      continue;
    }
    const group = groupFor[parameter.in];
    const path = `${group}.${parameter.name}`;
    parameterHints.push({
      path,
      ...(parameter.type ? { type: parameter.type.slice(0, 40) } : {}),
      required: parameter.required,
    });
    const value = parameterValue(userMessage, parameter, naturalLimit);
    if (value !== undefined) {
      (groups[group] ??= {})[parameter.name] = value;
    }
    if (parameter.required && value === undefined) missingParameterPaths.push(path);
  }
  return { params: groups, parameterHints, missingParameterPaths };
}

function addHint(
  hints: JevReadOperationHint[],
  input: Omit<JevReadOperationHint, 'key'>,
): void {
  if (hints.length >= JEV_READ_OPERATION_MAX_HINTS) return;
  hints.push({ ...input, key: `op_${hints.length}` });
}

function addOpenApiHints(
  hints: JevReadOperationHint[],
  connection: SourceListingConnection,
  userMessage: string,
): void {
  const parsed = parseOpenApiConnectionConfig(connection.config);
  if (!parsed) return;
  let spec;
  try {
    spec = parseOpenApiSpec(parsed.specId, parsed.specJson);
  } catch {
    return;
  }
  const sourceLabel = parsed.label ?? spec.title;
  for (const operation of spec.operations) {
    if (hints.length >= JEV_READ_OPERATION_MAX_HINTS) return;
    if (operation.method !== 'GET' && operation.method !== 'HEAD') continue;
    if (operation.sideEffect !== 'NONE' && operation.sideEffect !== 'REVERSIBLE') continue;
    const resolution = openApiParams(operation, userMessage);
    if (!resolution) continue;
    const summary = text(operation.summary, 180);
    const operationLabel = summary ?? operation.operationId;
    addHint(hints, {
      capabilityId: `openapi.${spec.id}.${operation.operationId}`,
      connector: 'openapi',
      sourceLabel: sourceLabel.slice(0, 160),
      label: text(`${sourceLabel}: ${operationLabel}`, 160) ?? operationLabel,
      description: text(`${sourceLabel}: ${operation.method} ${operation.path} — ${operationLabel}`, MAX_TEXT_CHARS) ?? operation.path,
      params: resolution.params,
      parameterHints: resolution.parameterHints,
      missingParameterPaths: resolution.missingParameterPaths,
    });
  }
}

function addRdbHints(
  hints: JevReadOperationHint[],
  connection: SourceListingConnection,
  userMessage: string,
): void {
  const config = asRecord(connection.config);
  if (!config) return;
  const connectionLabel = text(config.label, 100);
  addHint(hints, {
    capabilityId: 'rdb.schema.describe',
    connector: 'rdb',
    ...(connectionLabel ? { sourceLabel: connectionLabel } : {}),
    label: connectionLabel ? `${connectionLabel} 스키마` : 'DB 스키마',
    description: connectionLabel ? `${connectionLabel}의 허용된 테이블 목록 조회` : '허용된 DB 테이블 목록 조회',
    params: {},
  });

  const limit = requestLimitValue(userMessage);
  const tables = Array.isArray(config.allowedTables)
    ? config.allowedTables.filter((table): table is string => typeof table === 'string' && Boolean(table.trim())).slice(0, JEV_READ_OPERATION_MAX_HINTS)
    : [];
  for (const table of tables) {
    if (hints.length >= JEV_READ_OPERATION_MAX_HINTS) return;
    addHint(hints, {
      capabilityId: 'rdb.query.read',
      connector: 'rdb',
      ...(connectionLabel ? { sourceLabel: connectionLabel } : {}),
      label: `DB 조회: ${table.slice(0, 160)}`,
      description: `허용된 테이블 ${table.slice(0, 160)} 읽기`,
      params: { table, ...(limit === undefined ? {} : { limit }) },
    });
  }
}

function addMcpHints(hints: JevReadOperationHint[], connection: SourceListingConnection): void {
  const parsed = parseMcpConnectionConfig(connection.config);
  if (!parsed) return;
  for (const tool of parsed.tools) {
    if (hints.length >= JEV_READ_OPERATION_MAX_HINTS) return;
    if (tool.sideEffect !== 'NONE' && tool.sideEffect !== 'REVERSIBLE') continue;
    const schema = asRecord(tool.inputSchema);
    const required = Array.isArray(schema?.required)
      ? schema.required.filter((entry): entry is string => typeof entry === 'string')
      : [];
    if (required.some((name) => SENSITIVE_PARAMETER_NAME.test(name))) continue;
    const properties = asRecord(schema?.properties);
    const parameterNames = [...new Set([
      ...Object.keys(properties ?? {}),
      ...required,
    ])];
    const parameterHints = parameterNames
      .filter((name) => !SENSITIVE_PARAMETER_NAME.test(name))
      .slice(0, 50)
      .map((name) => ({
        path: name,
        ...(typeof properties?.[name] === 'object' && properties[name] !== null &&
          typeof (properties[name] as Record<string, unknown>).type === 'string'
          ? { type: String((properties[name] as Record<string, unknown>).type).slice(0, 40) }
          : {}),
        required: required.includes(name),
      }));
    const description = text(tool.description, MAX_TEXT_CHARS) ?? `MCP 읽기 도구 ${tool.name}`;
    addHint(hints, {
      capabilityId: `mcp.${parsed.serverId}.${tool.name}`,
      connector: 'mcp',
      sourceLabel: parsed.serverId,
      label: text(tool.name, 160) ?? 'MCP 읽기 도구',
      description,
      params: {},
      parameterHints,
      missingParameterPaths: required,
    });
  }
}

/**
 * Builds a bounded local catalog for Jev route selection.
 *
 * This is deliberately metadata-only: it parses persisted schemas and never
 * probes a network, opens a database, or includes credentials in the result.
 */
export function buildJevReadOperationHints(
  connections: readonly SourceListingConnection[],
  userMessage: string,
): JevReadOperationHint[] {
  const hints: JevReadOperationHint[] = [];
  for (const connection of connections) {
    if (!connection.connected || hints.length >= JEV_READ_OPERATION_MAX_HINTS) continue;
    if (connection.connector === 'openapi') addOpenApiHints(hints, connection, userMessage);
    if (connection.connector === 'rdb') addRdbHints(hints, connection, userMessage);
    if (connection.connector === 'mcp') addMcpHints(hints, connection);
  }
  return hints;
}
