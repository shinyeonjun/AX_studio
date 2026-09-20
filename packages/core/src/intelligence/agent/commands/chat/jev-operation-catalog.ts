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
  connector: 'openapi' | 'mcp' | 'rdb' | 'gmail' | 'slack';
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

export interface JevReadOperationSelection {
  hints: JevReadOperationHint[];
  totalCount: number;
  catalogMayBeBounded: boolean;
  /** How the local index decided which candidates to expose to Jev. */
  mode: 'empty_catalog' | 'full_catalog' | 'lexical_relevance' | 'no_lexical_match';
  /** Number of indexed operations matching at least one request token. */
  lexicalMatchedOperationCount: number;
  /** Highest number of request tokens matched by a single operation. */
  lexicalTopScore: number;
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

function operationSearchTerms(text: string): string[] {
  const terms = new Set(operationQueryTokens(text));
  for (const [rawToken] of text.matchAll(/[A-Za-z][A-Za-z0-9_-]*/gu)) {
    for (const part of rawToken.split(/(?<=[a-z])(?=[A-Z])/u)) {
      const normalized = part.toLocaleLowerCase();
      if (normalized.length >= 2 && !OPERATION_QUERY_STOP_WORDS.has(normalized)) terms.add(normalized);
    }
  }
  return [...terms];
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

type HintResolution = Pick<JevReadOperationHint, 'params' | 'parameterHints' | 'missingParameterPaths'>;
type HintMetadata = Pick<JevReadOperationHint, 'capabilityId' | 'connector' | 'sourceLabel' | 'label' | 'description'>;

interface IndexedReadOperation extends HintMetadata {
  key: string;
  searchTerms: readonly string[];
  resolve: (userMessage: string) => HintResolution | undefined;
}

function addIndexedOperation(
  operations: IndexedReadOperation[],
  input: HintMetadata,
  resolve: (userMessage: string) => HintResolution | undefined,
): void {
  const searchText = [input.sourceLabel, input.label, input.description, input.capabilityId]
    .filter(Boolean)
    .join(' ');
  operations.push({
    ...input,
    key: `op_${operations.length}`,
    searchTerms: operationSearchTerms(searchText),
    resolve,
  });
}

function addOpenApiOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
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
    if (operation.method !== 'GET' && operation.method !== 'HEAD') continue;
    if (operation.sideEffect !== 'NONE' && operation.sideEffect !== 'REVERSIBLE') continue;
    if (!openApiParams(operation, '')) continue;
    const summary = text(operation.summary, 180);
    const operationLabel = summary ?? operation.operationId;
    addIndexedOperation(operations, {
      capabilityId: `openapi.${spec.id}.${operation.operationId}`,
      connector: 'openapi',
      sourceLabel: sourceLabel.slice(0, 160),
      label: text(`${sourceLabel}: ${operationLabel}`, 160) ?? operationLabel,
      description: text(`${sourceLabel}: ${operation.method} ${operation.path} — ${operationLabel}`, MAX_TEXT_CHARS) ?? operation.path,
    }, (userMessage) => {
      const resolution = openApiParams(operation, userMessage);
      return resolution
        ? {
            params: resolution.params,
            parameterHints: resolution.parameterHints,
            missingParameterPaths: resolution.missingParameterPaths,
          }
        : undefined;
    });
  }
}

function addRdbOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
): void {
  const config = asRecord(connection.config);
  if (!config) return;
  const connectionLabel = text(config.label, 100);
  addIndexedOperation(operations, {
    capabilityId: 'rdb.schema.describe',
    connector: 'rdb',
    ...(connectionLabel ? { sourceLabel: connectionLabel } : {}),
    label: connectionLabel ? `${connectionLabel} 스키마` : 'DB 스키마',
    description: connectionLabel ? `${connectionLabel}의 허용된 테이블 목록 조회` : '허용된 DB 테이블 목록 조회',
  }, () => ({ params: {} }));

  const tables = Array.isArray(config.allowedTables)
    ? config.allowedTables.filter((table): table is string => typeof table === 'string' && Boolean(table.trim()))
    : [];
  for (const table of tables) {
    const safeTable = table.slice(0, 160);
    addIndexedOperation(operations, {
      capabilityId: 'rdb.query.read',
      connector: 'rdb',
      ...(connectionLabel ? { sourceLabel: connectionLabel } : {}),
      label: `DB 조회: ${safeTable}`,
      description: `허용된 테이블 ${safeTable} 읽기`,
    }, (userMessage) => {
      const limit = requestLimitValue(userMessage);
      return { params: { table, ...(limit === undefined ? {} : { limit }) } };
    });
  }
}

function addMcpOperations(operations: IndexedReadOperation[], connection: SourceListingConnection): void {
  const parsed = parseMcpConnectionConfig(connection.config);
  if (!parsed) return;
  for (const tool of parsed.tools) {
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
    const resolution: HintResolution = {
      params: {},
      parameterHints,
      missingParameterPaths: required,
    };
    addIndexedOperation(operations, {
      capabilityId: `mcp.${parsed.serverId}.${tool.name}`,
      connector: 'mcp',
      sourceLabel: parsed.serverId,
      label: text(tool.name, 160) ?? 'MCP 읽기 도구',
      description,
    }, () => resolution);
  }
}

function explicitSearchQuery(message: string): string | undefined {
  const labeled = message.match(/(?:query|q|검색어|검색\s*조건)\s*[:：=]\s*["']?([^"'\n]+)["']?\s*$/iu)?.[1]?.trim();
  if (labeled) return labeled.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
  const word = message.match(/([\p{L}\p{N}_-]{2,}?)(?:라는)?\s*단어/iu)?.[1]?.trim();
  return word?.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
}

function addGmailOperations(operations: IndexedReadOperation[]): void {
  addIndexedOperation(operations, {
    capabilityId: 'gmail.messages.search',
    connector: 'gmail',
    sourceLabel: 'Gmail',
    label: 'Gmail 메일 검색',
    description: 'Gmail의 메일 목록 또는 명시된 조건의 헤더 조회',
  }, (userMessage) => {
    const query = explicitSearchQuery(userMessage);
    const limit = requestLimitValue(userMessage);
    const includeMetadata = /(?:보낸\s*사람|발신자|제목|날짜|헤더|metadata|subject|from|date)/iu.test(userMessage);
    return {
      params: {
        ...(query ? { query } : {}),
        ...(limit === undefined ? {} : { limit }),
        ...(includeMetadata ? { includeMetadata: true } : {}),
      },
    };
  });
}

function addSlackOperations(operations: IndexedReadOperation[]): void {
  addIndexedOperation(operations, {
    capabilityId: 'slack.messages.search',
    connector: 'slack',
    sourceLabel: 'Slack',
    label: 'Slack 메시지 검색',
    description: 'Slack의 명시된 검색어에 해당하는 메시지 조회',
  }, (userMessage) => {
    const query = explicitSearchQuery(userMessage);
    const limit = requestLimitValue(userMessage);
    return {
      params: {
        ...(query ? { query } : {}),
        ...(limit === undefined ? {} : { limit }),
      },
      parameterHints: [{ path: 'query', type: 'string', required: true }],
      missingParameterPaths: query ? [] : ['query'],
    };
  });
}

export class JevReadOperationIndex {
  private readonly operations: readonly IndexedReadOperation[];
  private readonly termIndex: ReadonlyMap<string, readonly number[]>;

  constructor(connections: readonly SourceListingConnection[]) {
    const operations: IndexedReadOperation[] = [];
    for (const connection of connections) {
      if (!connection.connected) continue;
      if (connection.connector === 'openapi') addOpenApiOperations(operations, connection);
      if (connection.connector === 'rdb') addRdbOperations(operations, connection);
      if (connection.connector === 'mcp') addMcpOperations(operations, connection);
      if (connection.connector === 'gmail') addGmailOperations(operations);
      if (connection.connector === 'slack') addSlackOperations(operations);
    }
    this.operations = operations;

    const termIndex = new Map<string, number[]>();
    for (const [index, operation] of operations.entries()) {
      for (const term of operation.searchTerms) {
        const postings = termIndex.get(term);
        if (postings) postings.push(index);
        else termIndex.set(term, [index]);
      }
    }
    this.termIndex = termIndex;
  }

  select(userMessage: string): JevReadOperationSelection {
    const catalogMayBeBounded = this.operations.length >= JEV_READ_OPERATION_MAX_HINTS;
    const scores = new Map<number, number>();
    for (const term of new Set(operationQueryTokens(userMessage))) {
      for (const index of this.termIndex.get(term) ?? []) {
        scores.set(index, (scores.get(index) ?? 0) + 1);
      }
    }
    let lexicalTopScore = 0;
    for (const score of scores.values()) lexicalTopScore = Math.max(lexicalTopScore, score);
    const mode = this.operations.length === 0
      ? 'empty_catalog'
      : catalogMayBeBounded
        ? scores.size > 0 ? 'lexical_relevance' : 'no_lexical_match'
        : 'full_catalog';
    let selected: readonly IndexedReadOperation[] = this.operations;
    if (catalogMayBeBounded) {
      selected = [...scores.entries()]
        .sort((left, right) => right[1] - left[1] || left[0] - right[0])
        .slice(0, JEV_READ_OPERATION_MAX_HINTS)
        .map(([index]) => this.operations[index]);
    }

    const hints = selected
      .map((operation) => {
        const resolution = operation.resolve(userMessage);
        return resolution ? { ...operation, ...resolution } : undefined;
      })
      .filter((hint): hint is IndexedReadOperation & HintResolution => hint !== undefined)
      .map(({ resolve: _resolve, searchTerms: _searchTerms, ...hint }) => hint);

    return {
      hints,
      totalCount: this.operations.length,
      catalogMayBeBounded,
      mode,
      lexicalMatchedOperationCount: scores.size,
      lexicalTopScore,
    };
  }
}

export function buildJevReadOperationIndex(
  connections: readonly SourceListingConnection[],
): JevReadOperationIndex {
  return new JevReadOperationIndex(connections);
}

/**
 * Builds a query-specific local catalog for Jev route selection.
 *
 * This is deliberately metadata-only: it parses persisted schemas and never
 * probes a network, opens a database, or includes credentials in the result.
 */
export function buildJevReadOperationHints(
  connections: readonly SourceListingConnection[],
  userMessage: string,
): JevReadOperationHint[] {
  return buildJevReadOperationIndex(connections).select(userMessage).hints;
}
