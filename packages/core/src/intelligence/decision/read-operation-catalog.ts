import type { SourceListingConnection } from '../../connectors/types.js';
import { parseHttpEndpoints } from '../../connectors/http/connection.js';
import { parseLocalFolderConnectionConfig } from '../../platform/local-folder-config.js';
import {
  parseOpenApiConnectionConfig,
  parseOpenApiSpec,
  type OpenApiOperation,
  type OpenApiParameter,
} from '../../connectors/protocols/openapi/index.js';
import { MAX_DECISION_CHOICE_CRITERIA } from '../../contracts/decision.js';
import { requestLimitCandidates } from './request-limit.js';

// Reserve one provider choice for `none` so each operation question stays valid.
const JEV_READ_OPERATION_MAX_CHOICES = MAX_DECISION_CHOICE_CRITERIA - 1;
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
  connector: 'http' | 'openapi' | 'rdb' | 'gmail' | 'slack' | 'local_folder' | 'local_sheet';
  sourceLabel?: string;
  label: string;
  description: string;
  params: Record<string, unknown>;
  /** Schema-declared parameter paths; finite choices may be selected by Jev, open values stay host/user supplied. */
  parameterHints?: readonly JevReadParameterHint[];
  /** Required paths still absent from the host-resolved params. */
  missingParameterPaths?: readonly string[];
}

export interface JevReadParameterHint {
  path: string;
  type?: string;
  description?: string;
  required: boolean;
  choices?: readonly (string | number | boolean)[];
}

export interface JevReadOperationSelection {
  hints: JevReadOperationHint[];
  totalCount: number;
  catalogMayBeBounded: boolean;
  /** Catalog mode; `lexical_relevance` changes ordering without removing candidates. */
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

export function operationQueryTokens(message: string): string[] {
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
 * Uses lexical relevance only to order oversized catalogs. Jev still receives
 * every eligible operation and makes the semantic selection.
 */
export function selectJevReadOperationHints(
  hints: readonly JevReadOperationHint[],
  userMessage: string,
): readonly JevReadOperationHint[] {
  if (hints.length <= JEV_READ_OPERATION_MAX_CHOICES) return hints;

  const tokens = operationQueryTokens(userMessage);
  if (tokens.length === 0) return hints;
  return hints
    .map((hint, index) => {
      const text = [hint.sourceLabel, hint.label, hint.description, hint.capabilityId]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase();
      const score = tokens.reduce((total, token) => total + (text.includes(token) ? 1 : 0), 0);
      return { hint, index, score };
    })
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
  if (!value || value.length > MAX_EXPLICIT_PARAMETER_CHARS) return undefined;
  return value.replace(/^([A-Za-z0-9][A-Za-z0-9._:-]*)(?:으로|에서|에게|을|를|이|가|은|는|와|과|로|에)$/u, '$1');
}

function parameterValue(message: string, parameter: OpenApiParameter): string | number | boolean | undefined {
  if (parameter.in === 'header' || parameter.in === 'cookie' || SENSITIVE_PARAMETER_NAME.test(parameter.name)) {
    return undefined;
  }
  const raw = explicitParameterValue(message, parameter.name);
  if (raw === undefined) return undefined;
  let value: string | number | boolean | undefined;
  if (parameter.type === 'integer' || parameter.type === 'number') {
    const numeric = Number(raw);
    value = Number.isFinite(numeric) && (parameter.type !== 'integer' || Number.isInteger(numeric))
      ? numeric
      : undefined;
  } else if (parameter.type === 'boolean') {
    value = /^(?:true|yes|예|맞아)$/iu.test(raw)
      ? true
      : /^(?:false|no|아니)$/iu.test(raw) ? false : undefined;
  } else {
    value = raw;
  }
  return value !== undefined && parameter.enum && !parameter.enum.includes(value) ? undefined : value;
}

function isTopNLimitCandidate(value: number, message: string): boolean {
  const pattern = new RegExp(
    `(?:` +
      `(?:제일|가장|최저|최고|상위|하위)\\s*(?:\\S+\\s*)?${value}\\s*(?:개|건|명|개만|항목)?` +
      `|` +
      `(?:적은|많은|높은|낮은|비싼|저렴한|싼|큰|작은)\\s*(?:것|거|상품|항목|데이터)?\\s*${value}\\s*(?:개|건|명|개만|항목)?` +
      `|` +
      `${value}\\s*(?:개|건|명)?\\s*(?:제일|가장|최저|최고)` +
      `|` +
      `\\b(?:top|bottom)\\s*${value}\\b` +
      `|` +
      `순(?:으로)?\\s*${value}\\s*(?:개|건|명|항목)?` +
    `)`,
    'iu',
  );
  return pattern.test(message);
}

function naturalLimitChoices(name: string, type: string | undefined, message: string): readonly number[] | undefined {
  if (!NATURAL_LIMIT_PARAMETER_NAMES.has(name.toLowerCase()) || !['integer', 'number'].includes(type ?? '')) {
    return undefined;
  }
  const choices = requestLimitCandidates(message).filter((value) =>
    (type !== 'integer' || Number.isInteger(value)) && !isTopNLimitCandidate(value, message),
  );
  return choices.length > 0 ? choices : undefined;
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
      ...(parameter.description ? { description: parameter.description.slice(0, 180) } : {}),
      required: parameter.required,
      ...((parameter.enum ?? naturalLimitChoices(parameter.name, parameter.type, userMessage))
        ? { choices: parameter.enum ?? naturalLimitChoices(parameter.name, parameter.type, userMessage) }
        : {}),
    });
    const value = parameterValue(userMessage, parameter)
      ?? (parameter.in === 'query' && isSearchParameter(parameter.name)
        ? explicitSearchQuery(userMessage)
        : undefined);
    if (value !== undefined) {
      (groups[group] ??= {})[parameter.name] = value;
    }
    if (parameter.required && value === undefined) missingParameterPaths.push(path);
  }
  return { params: groups, parameterHints, missingParameterPaths };
}

function isSearchParameter(name: string): boolean {
  return /^(?:q|query|search|search[_-]?term|keyword|keywords)$/iu.test(name);
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
    spec = parseOpenApiSpec(parsed.specId, parsed.specJson, parsed.baseUrl);
  } catch {
    return;
  }
  const sourceLabel = parsed.label ?? spec.title;
  for (const operation of spec.operations) {
    if (operation.method !== 'GET' && operation.method !== 'HEAD') continue;
    if (operation.sideEffect !== 'NONE') continue;
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

function addHttpOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
): void {
  for (const endpoint of parseHttpEndpoints(connection.config)) {
    if (endpoint.auth?.type !== 'none' && endpoint.authStored !== true) continue;
    const sourceLabel = text(endpoint.label, 100);
    for (const operation of endpoint.discoveredReadOperations ?? []) {
      // Only paths the connected service itself advertised become operations. A
      // `/search` collection exposes its query as a host-resolved parameter.
      const searchPath = /(?:^|\/)search$/iu.test(operation.path.replace(/[?#].*$/u, '').replace(/\/+$/u, ''));
      addIndexedOperation(operations, {
        capabilityId: 'http.request',
        connector: 'http',
        ...(sourceLabel ? { sourceLabel } : {}),
        label: text(`${sourceLabel ? `${sourceLabel}: ` : ''}${operation.label}`, 160) ?? operation.label,
        description: text(`${sourceLabel ? `${sourceLabel}: ` : ''}GET ${operation.path} — ${operation.label}`, MAX_TEXT_CHARS)
          ?? `GET ${operation.path}`,
      }, (userMessage) => {
        const query = searchPath ? explicitSearchQuery(userMessage) : undefined;
        return {
          params: {
            method: 'GET',
            path: operation.path,
            connectionId: endpoint.id,
            ...(query ? { query: { q: query } } : {}),
          },
          parameterHints: [
            ...(searchPath ? [{
              path: 'query.q',
              type: 'string',
              description: 'Search text explicitly provided by the user.',
              required: true,
            }] : []),
            {
              path: 'query.limit',
              type: 'integer',
              description: 'Maximum number of collection items to return.',
              required: false,
              ...(naturalLimitChoices('limit', 'integer', userMessage)
                ? { choices: naturalLimitChoices('limit', 'integer', userMessage) }
                : {}),
            },
          ],
          ...(searchPath && !query ? { missingParameterPaths: ['query.q'] } : {}),
        };
      });
    }
  }
}

function addRdbOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
): void {
  const config = asRecord(connection.config);
  if (!config) return;
  const connectionLabel = text(config.label, 100);
  const tables = Array.isArray(config.allowedTables)
    ? config.allowedTables.filter((table): table is string => typeof table === 'string' && Boolean(table.trim()))
    : [];
  if (tables.length > 0) {
    addIndexedOperation(operations, {
      capabilityId: 'rdb.schema.describe',
      connector: 'rdb',
      ...(connectionLabel ? { sourceLabel: connectionLabel } : {}),
      label: connectionLabel ? `${connectionLabel} 스키마` : 'DB 스키마',
      description: connectionLabel
        ? `${connectionLabel}의 허용된 테이블 목록 및 DB 스키마 구조 조회 (테이블 구조 확인 전용)`
        : '허용된 DB 테이블 목록 및 스키마 구조 조회 (테이블 구조 확인 전용)',
    }, () => ({ params: {} }));
  }
  for (const table of tables) {
    const safeTable = table.slice(0, 160);
    addIndexedOperation(operations, {
      capabilityId: 'rdb.query.read',
      connector: 'rdb',
      ...(connectionLabel ? { sourceLabel: connectionLabel } : {}),
      label: `DB 조회: ${safeTable}`,
      description: `허용된 테이블 ${safeTable} 읽기`,
    }, (userMessage) => {
      const choices = naturalLimitChoices('limit', 'integer', userMessage);
      return {
        params: { table },
        parameterHints: [{
          path: 'limit',
          type: 'integer',
          description: 'Maximum number of rows to return.',
          required: false,
          ...(choices ? { choices } : {}),
        }],
      };
    });
  }
}

function explicitSearchQuery(message: string): string | undefined {
  const labeled = ['query', 'q', '검색어', '검색조건', '검색 조건']
    .map((name) => explicitParameterValue(message, name))
    .find((value): value is string => Boolean(value));
  if (labeled) return labeled.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
  const quoted = message.match(/(?:query|q|검색어|검색\s*조건)\s*[:：=]\s*["']([^"'\n]{1,500})["']/iu)?.[1]?.trim();
  if (quoted) return quoted.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
  const word = message.match(/([\p{L}\p{N}_-]{2,}?)(?:라는)?\s*단어/iu)?.[1]?.trim();
  if (word) return word.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
  const related = message.match(/(?:^|\s)([\p{L}\p{N}_-]{2,})\s*(?:관련(?:된)?|에\s*대한|포함(?:된)?|언급(?:된)?|about|related\s+to)/iu)?.[1]?.trim();
  return related?.slice(0, MAX_EXPLICIT_PARAMETER_CHARS);
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
    const limit = parameterValue(userMessage, { name: 'limit', in: 'query', required: false, type: 'integer' });
    const includeMetadata = /(?:보낸\s*사람|발신자|제목|날짜|헤더|metadata|subject|from|date)/iu.test(userMessage);
    return {
      params: {
        ...(query ? { query } : {}),
        ...(limit === undefined ? {} : { limit }),
        ...(includeMetadata ? { includeMetadata: true } : {}),
      },
      parameterHints: [{
        path: 'limit', type: 'integer', required: false,
        ...(naturalLimitChoices('limit', 'integer', userMessage)
          ? { choices: naturalLimitChoices('limit', 'integer', userMessage) }
          : {}),
      }],
    };
  });
}

/**
 * The channel a request names: "#ops" or "운영팀 채널". Only what the person wrote; a request
 * without one is asked for it, never given a guessed channel.
 */
export function explicitSlackChannel(message: string): string | undefined {
  const hashed = /(?:^|[\s(])#([\p{L}\p{N}_.-]{1,80})/u.exec(message)?.[1];
  if (hashed) return `#${hashed}`;
  const named = /([\p{L}\p{N}_.-]{1,80})\s*채널(?!\s*목록)/u.exec(message)?.[1];
  return named && !/^(?:slack|슬랙|이|그|저|어느|무슨|모든|전체|각)$/iu.test(named) ? `#${named}` : undefined;
}

function addSlackOperations(operations: IndexedReadOperation[]): void {
  addIndexedOperation(operations, {
    capabilityId: 'slack.channels.list',
    connector: 'slack',
    sourceLabel: 'Slack',
    label: 'Slack 채널 목록',
    description: 'Slack 워크스페이스에서 볼 수 있는 채널 목록 조회',
  }, (userMessage) => {
    const limit = parameterValue(userMessage, { name: 'limit', in: 'query', required: false, type: 'integer' });
    return { params: limit === undefined ? {} : { limit }, parameterHints: [] };
  });
  addIndexedOperation(operations, {
    capabilityId: 'slack.messages.read',
    connector: 'slack',
    sourceLabel: 'Slack',
    label: 'Slack 채널 최근 메시지',
    description: '지정한 Slack 채널의 최근 메시지 읽기',
  }, (userMessage) => {
    const channel = explicitSlackChannel(userMessage);
    const limit = parameterValue(userMessage, { name: 'limit', in: 'query', required: false, type: 'integer' });
    return {
      params: {
        ...(channel ? { channel } : {}),
        ...(limit === undefined ? {} : { limit }),
      },
      parameterHints: [
        { path: 'channel', type: 'string', required: true },
        {
          path: 'limit', type: 'integer', required: false,
          ...(naturalLimitChoices('limit', 'integer', userMessage)
            ? { choices: naturalLimitChoices('limit', 'integer', userMessage) }
            : {}),
        },
      ],
      missingParameterPaths: channel ? [] : ['channel'],
    };
  });
  addIndexedOperation(operations, {
    capabilityId: 'slack.messages.search',
    connector: 'slack',
    sourceLabel: 'Slack',
    label: 'Slack 메시지 검색',
    description: 'Slack의 명시된 검색어에 해당하는 메시지 조회',
  }, (userMessage) => {
    const query = explicitSearchQuery(userMessage);
    const limit = parameterValue(userMessage, { name: 'limit', in: 'query', required: false, type: 'integer' });
    return {
      params: {
        ...(query ? { query } : {}),
        ...(limit === undefined ? {} : { limit }),
      },
      parameterHints: [
        { path: 'query', type: 'string', required: true },
        {
          path: 'limit', type: 'integer', required: false,
          ...(naturalLimitChoices('limit', 'integer', userMessage)
            ? { choices: naturalLimitChoices('limit', 'integer', userMessage) }
            : {}),
        },
      ],
      missingParameterPaths: query ? [] : ['query'],
    };
  });
}

function explicitSheetPath(message: string): string | undefined {
  const labeled = /(?:^|[\s,;])(?:path|file|파일(?:\s*경로)?)\s*[:=]\s*(?:"([^"]{1,500})"|“([^”]{1,500})”|'([^']{1,500})'|([^\s,;]{1,500}))/iu.exec(message);
  const labeledValue = labeled?.slice(1).find((value): value is string => typeof value === 'string');
  if (labeledValue) return /\.(?:csv|xlsx?)$/iu.test(labeledValue) ? labeledValue : undefined;

  const quoted = [...message.matchAll(/["“'`]([^"'“”`\r\n]{1,500}\.(?:csv|xlsx?))["”'`]/giu)]
    .map((match) => match[1]);
  if (quoted.length > 0) {
    const unique = [...new Set(quoted)];
    return unique.length === 1 ? unique[0] : undefined;
  }

  const bare = [...message.matchAll(/(?:^|[\s])([^\s<>|?*;,"'`]{1,500}\.(?:csv|xlsx?))(?=$|[\s.,!?]|(?:에서|으로|부터|까지|을|를|은|는|의|에|로))/giu)]
    .map((match) => match[1]);
  const unique = [...new Set(bare)];
  return unique.length === 1 ? unique[0] : undefined;
}

function explicitSheetName(message: string): string | undefined {
  const match = /(?:^|[\s,;])(?:sheet(?:Name)?|시트)\s*[:=]\s*(?:"([^"]{1,200})"|“([^”]{1,200})”|'([^']{1,200})'|([^\s,;]{1,200}))/iu.exec(message);
  return match?.slice(1).find((value): value is string => typeof value === 'string')?.trim() || undefined;
}

function addLocalFolderOperations(
  operations: IndexedReadOperation[],
  connection: SourceListingConnection,
): void {
  const config = parseLocalFolderConnectionConfig(connection.config);
  for (const folder of config?.folders ?? []) {
    const sourceLabel = text(folder.label, 160) ?? '로컬 폴더';
    addIndexedOperation(operations, {
      capabilityId: 'local_folder.list',
      connector: 'local_folder',
      sourceLabel,
      label: `${sourceLabel}: 파일 목록`.slice(0, 160),
      description: '연결 폴더의 파일 목록 조회',
    }, (userMessage) => {
      const offset = explicitParameterValue(userMessage, 'offset');
      const parsedOffset = offset && /^\d+$/u.test(offset) ? Number(offset) : undefined;
      const explicitLimit = parameterValue(userMessage, { name: 'limit', in: 'query', required: false, type: 'integer' });
      const limitChoices = naturalLimitChoices('limit', 'integer', userMessage);
      return {
        params: {
          folderId: folder.id,
          ...(explicitLimit !== undefined ? { limit: explicitLimit } : limitChoices ? {} : { limit: 20 }),
          ...(parsedOffset !== undefined && Number.isSafeInteger(parsedOffset) ? { offset: parsedOffset } : {}),
        },
        parameterHints: [{
          path: 'limit', type: 'integer', required: false,
          ...(limitChoices ? { choices: limitChoices } : {}),
        }],
      };
    });

    addIndexedOperation(operations, {
      capabilityId: 'local_sheet.read',
      connector: 'local_sheet',
      sourceLabel,
      label: `${sourceLabel}: 스프레드시트 읽기`.slice(0, 160),
      description: '연결 폴더에서 지정한 CSV/XLSX 파일의 표를 읽기',
    }, (userMessage) => {
      const path = explicitSheetPath(userMessage);
      const sheet = explicitSheetName(userMessage);
      return {
        params: {
          folderId: folder.id,
          ...(path ? { path } : {}),
          ...(sheet ? { sheet } : {}),
        },
        parameterHints: [
          { path: 'path', type: 'string', required: true },
          { path: 'sheet', type: 'string', required: false },
        ],
        missingParameterPaths: path ? [] : ['path'],
      };
    });
  }
}

export class JevReadOperationIndex {
  private readonly operations: readonly IndexedReadOperation[];
  private readonly termIndex: ReadonlyMap<string, readonly number[]>;

  constructor(connections: readonly SourceListingConnection[]) {
    const operations: IndexedReadOperation[] = [];
    for (const connection of connections) {
      if (!connection.connected) continue;
      if (connection.connector === 'http') addHttpOperations(operations, connection);
      if (connection.connector === 'openapi') addOpenApiOperations(operations, connection);
      if (connection.connector === 'rdb') addRdbOperations(operations, connection);
      if (connection.connector === 'gmail') addGmailOperations(operations);
      if (connection.connector === 'slack') addSlackOperations(operations);
      if (connection.connector === 'local_folder') addLocalFolderOperations(operations, connection);
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
    const scores = new Map<number, number>();
    for (const term of new Set(operationQueryTokens(userMessage))) {
      for (const index of this.termIndex.get(term) ?? []) {
        scores.set(index, (scores.get(index) ?? 0) + 1);
      }
    }
    let lexicalTopScore = 0;
    for (const score of scores.values()) lexicalTopScore = Math.max(lexicalTopScore, score);
    let mode: JevReadOperationSelection['mode'];
    let selected: readonly IndexedReadOperation[];
    if (this.operations.length === 0) {
      mode = 'empty_catalog';
      selected = [];
    } else if (this.operations.length <= JEV_READ_OPERATION_MAX_CHOICES) {
      // When the provider can accept the whole catalog, keep semantic ranking with Jev.
      mode = 'full_catalog';
      selected = this.operations;
    } else if (scores.size > 0) {
      mode = 'lexical_relevance';
      selected = this.operations
        .map((operation, index) => ({ operation, score: scores.get(index) ?? 0, index }))
        .sort((left, right) => right.score - left.score || left.index - right.index)
        .map(({ operation }) => operation);
    } else {
      // Jev allows 255 choices, including `none`; the router chunks this full
      // metadata catalog into provider-sized choice questions.
      mode = 'no_lexical_match';
      selected = this.operations;
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
      catalogMayBeBounded: hints.length < this.operations.length,
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
