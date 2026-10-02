import type { AxCommand } from '../schema.js';
import type { MetadataOutputKind, SourceMetadataEvidence } from '../../../../contracts/request-understanding.js';

/** Only an explicit output request can opt into raw metadata. This is syntax, not intent parsing. */
export function explicitlyRequestsRawMetadata(text: string): boolean {
  // A quoted term or bare mention is not an output directive. Unknown syntax stays readable.
  const unquoted = text.replace(/```[\s\S]*?```|`[^`]*`|"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/gu, ' ');
  const mentions = [...unquoted.matchAll(/\b(?:(?:raw|debug)\s+)?json\b|원시\s*json|디버그\s*(?:용\s*)?json/giu)];
  let affirmative = false;
  for (const mention of mentions) {
    const before = unquoted.slice(Math.max(0, mention.index - 64), mention.index);
    const after = unquoted.slice(mention.index + mention[0].length, mention.index + mention[0].length + 64);
    if (/\b(?:do\s+not|don't|not|without|instead\s+of|avoid|never|no)\b[^.;\n]{0,48}$/iu.test(before)
      || /^(?:[^.;\n]{0,32})(?:말고|없이|말아|금지|하지\s*마|안\s*(?:돼|되|쓰|보|사용|출력)|\bnot\s+(?:wanted|needed|allowed)\b)/iu.test(after)) return false;
    if (/^\s*(?:(?:으로|형태로|형식으로|원문|그대로)\s*)?(?:보여|출력|반환|표시)/u.test(after)
      || (/\b(?:show|print|output|return|render|provide|give|export|dump)\b[^.;?\n]{0,56}$/iu.test(before)
        && /^\s*(?:(?:please|format|output)\b\s*)?(?:[.!?]?\s*$|\b(?:of|for)\b)/iu.test(after))) affirmative = true;
  }
  return affirmative;
}

export function inertMetadataText(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/gu, ' ').replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/[\\`*_{}\[\]()#!|]/gu, '\\$&');
}

function jsonFence(value: unknown): string {
  const body = JSON.stringify(value, null, 2);
  const fence = '`'.repeat(Math.max(3, ...[...body.matchAll(/`+/gu)].map(match => match[0].length + 1)));
  return `${fence}json\n${body}\n${fence}`;
}

export function renderSourceMetadata(sourceLabel: string, evidence: SourceMetadataEvidence,
  outputKind: MetadataOutputKind): string {
  if (outputKind === 'raw_debug') return jsonFence(evidence);
  const label = inertMetadataText(sourceLabel);
  const coverage = evidence.truncated || evidence.knownTotal === null || evidence.knownTotal > evidence.entries.length
    ? '\n현재 등록된 메타데이터의 일부이며, 원천 데이터 전체를 확인한 것은 아닙니다.'
    : '\n현재 등록된 메타데이터 범위입니다. 실제 레코드는 조회하지 않았습니다.';
  if (evidence.intent === 'connection_status') {
    const status = evidence.status;
    if (!status) return `${label}: 연결 상태 메타데이터가 없습니다.`;
    const authentication = { ready: '인증 준비 상태 확인됨', not_ready: '인증 준비 안 됨', unknown: '미확인' };
    const permission = { verified: '검증됨', denied: '거부됨', unknown: '미확인' };
    const health = { healthy: '정상 확인됨', unhealthy: '문제 확인됨', unknown: '미확인' };
    return `${label} 연결 상태:\n- 카탈로그: ${status.catalogExists ? '등록됨' : '미등록'}\n`
      + `- 설정: ${status.configured ? '저장됨' : '미설정'}\n- 인증: ${authentication[status.authentication]}\n`
      + `- 작업 권한: ${permission[status.operationPermission]}\n- 현재 상태: ${health[status.health]}`;
  }
  const title = evidence.intent === 'schema' ? '등록된 스키마' : '등록된 데이터 종류';
  const rows = evidence.entries.map(entry => `- ${inertMetadataText(entry.label || entry.id)}`
    + (entry.fields?.length ? `: ${entry.fields.map(field => `${inertMetadataText(field.name)} (${inertMetadataText(field.type)})`).join(', ')}` : ''));
  return `${label} ${title}:\n${rows.length ? rows.join('\n') : '등록된 항목이 없습니다.'}${coverage}`;
}

interface MetadataView {
  fields: readonly string[];
  lists?: Readonly<Record<string, MetadataView>>;
  objects?: Readonly<Record<string, MetadataView>>;
}
const PAGE_FIELDS = ['count', 'total', 'totalMatches', 'totalSources', 'totalTools', 'totalOperations', 'endpointCount', 'nextOffset', 'truncated'];
const IDENTITY_FIELDS = ['id', 'label', 'name', 'connector', 'kind', 'type', 'status', 'connected', 'connectable', 'availability'];
const FIELD_VIEW: MetadataView = { fields: ['name', 'label', 'type', 'format', 'nullable', 'required', 'in', 'description'] };
const ENTRY_VIEW: MetadataView = { fields: IDENTITY_FIELDS, lists: { fields: FIELD_VIEW, columns: FIELD_VIEW, params: FIELD_VIEW } };
const RESPONSE_VIEW: MetadataView = { fields: ['status', 'description', 'required'], lists: { fields: FIELD_VIEW } };
const OPERATION_VIEW: MetadataView = { fields: [...IDENTITY_FIELDS, 'operationId', 'method', 'path', 'summary', 'sideEffect'],
  lists: { params: FIELD_VIEW, parameters: FIELD_VIEW, responses: RESPONSE_VIEW }, objects: { requestBody: RESPONSE_VIEW } };
const CAPABILITY_VIEW: MetadataView = { ...ENTRY_VIEW, fields: [...IDENTITY_FIELDS, 'available', 'reason', 'sideEffect'] };
const DETAILS_VIEW: MetadataView = { fields: ['available', 'reason', 'table', 'folderId', ...PAGE_FIELDS],
  lists: { operations: OPERATION_VIEW, tools: CAPABILITY_VIEW },
  objects: { capability: CAPABILITY_VIEW, schema: ENTRY_VIEW, api: { fields: ['id', 'title'] }, endpoint: ENTRY_VIEW,
    operationSchema: { fields: [], lists: { operations: OPERATION_VIEW } } } };
const SOURCE_VIEW: MetadataView = { ...ENTRY_VIEW, fields: [...IDENTITY_FIELDS, ...PAGE_FIELDS], lists: { sources: ENTRY_VIEW } };

/** These views follow the command producers, not arbitrary keys in connector envelopes. */
const COMMAND_VIEWS: Partial<Record<AxCommand['name'], MetadataView>> = {
  'resource.list': { fields: PAGE_FIELDS, lists: { resources: { fields: [...IDENTITY_FIELDS, ...PAGE_FIELDS], lists: { endpoints: ENTRY_VIEW } } } },
  'source.list': { fields: [...IDENTITY_FIELDS, ...PAGE_FIELDS], lists: { sources: SOURCE_VIEW } },
  'source.files.list': { fields: PAGE_FIELDS, lists: { files: { fields: [...IDENTITY_FIELDS, 'fileName'] } } },
  'session.source.list': { fields: PAGE_FIELDS, lists: { sources: { fields: [...IDENTITY_FIELDS, 'fileName', 'pageCount', 'errorCode'] } } },
  'capability.list': { fields: PAGE_FIELDS, lists: { capabilities: CAPABILITY_VIEW } },
  'capability.describe': { ...CAPABILITY_VIEW, objects: { capability: CAPABILITY_VIEW } },
  'discovery.search': { fields: PAGE_FIELDS, lists: { candidates: ENTRY_VIEW, assets: ENTRY_VIEW } },
  'discovery.describe': { fields: ['depth'], objects: { asset: ENTRY_VIEW, details: DETAILS_VIEW, fieldPage: { fields: PAGE_FIELDS } } },
};

/** Debug and readable output share exactly the same bounded, approved view. */
function approvedMetadata(value: unknown, view: MetadataView): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of view.fields) {
    const item = record[key];
    if (typeof item === 'string') {
      result[key] = item.slice(0, key === 'fileName' ? 240 : 500);
      if (result[key] !== item) result.truncated = true;
    }
    else if (typeof item === 'boolean') result[key] = item;
    else if (Number.isSafeInteger(item) && (item as number) >= 0) result[key] = item;
  }
  for (const [key, child] of Object.entries(view.lists ?? {})) {
    if (Array.isArray(record[key])) {
      result[key] = record[key].slice(0, 64).map(item => approvedMetadata(item, child));
      if (record[key].length > 64) result.truncated = true;
    }
  }
  for (const [key, child] of Object.entries(view.objects ?? {})) {
    if (record[key] && typeof record[key] === 'object' && !Array.isArray(record[key])) result[key] = approvedMetadata(record[key], child);
  }
  return result;
}

export function renderCatalogMetadata(command: AxCommand, data: unknown, raw: boolean): string {
  const view = COMMAND_VIEWS[command.name];
  const approved = view ? approvedMetadata(data, view) : {};
  const named = (entry: Record<string, unknown>) => [entry.label, entry.fileName, entry.name, entry.title, entry.operationId, entry.id, entry.connector, entry.table]
    .find(value => typeof value === 'string') as string | undefined;
  const sections = (entry: Record<string, unknown>): Record<string, unknown>[] => Object.values(entry).flatMap(value =>
    Array.isArray(value) ? value : value && typeof value === 'object' ? [value as Record<string, unknown>] : []);
  // Paging counters alone do not establish a recognized collection, much less an empty one.
  if (!named(approved) && !sections(approved).length && !Object.values(approved).some(Array.isArray)) {
    return '표시할 메타데이터 형식을 확인하지 못했습니다. 등록된 명세를 확인해 주세요.';
  }
  if (raw) return jsonFence(approved);
  const titles: Partial<Record<AxCommand['name'], string>> = {
    'resource.list': '등록된 리소스', 'source.list': '등록된 자료', 'source.files.list': '등록된 파일',
    'session.source.list': '현재 대화 자료', 'capability.list': '등록된 도구', 'capability.describe': '도구 정보',
    'discovery.search': '등록된 데이터·도구', 'discovery.describe': '등록된 메타데이터',
  };
  const lines: string[] = [];
  const coverage: string[] = [];
  const visit = (entry: Record<string, unknown>) => {
    const name = named(entry);
    const details = ['type', 'kind', 'status', 'availability', 'method', 'path', 'reason', 'description'].flatMap(key =>
      typeof entry[key] === 'string' ? [inertMetadataText(entry[key] as string)] : []);
    if (typeof entry.connected === 'boolean') details.push(`저장된 연결 상태: ${entry.connected ? '연결됨' : '연결 안 됨'}`);
    if (typeof entry.available === 'boolean') details.push(`등록된 사용 준비 상태: ${entry.available ? '준비됨' : '준비 안 됨'}`);
    if (name) lines.push(`- ${inertMetadataText(name)}${details.length ? ` — ${details.join(', ')}` : ''}`);
    if (entry.truncated === true || typeof entry.nextOffset === 'number') coverage.push('현재 카탈로그의 일부만 표시했습니다.'
      + (typeof entry.nextOffset === 'number' ? ` 다음 위치: ${entry.nextOffset}.` : ''));
    for (const key of ['totalMatches', 'total', 'totalSources', 'totalTools', 'totalOperations', 'endpointCount']) {
      if (typeof entry[key] === 'number') coverage.push(`등록된 범위 (${name ? inertMetadataText(name) : key}): ${entry[key]}개.`);
    }
    sections(entry).forEach(visit);
  };
  visit(approved);
  return `${titles[command.name] ?? '메타데이터'}:\n${lines.length ? lines.join('\n') : sections(approved).length ? '표시할 메타데이터 이름이 없습니다.' : '등록된 항목이 없습니다.'}`
    + (coverage.length ? `\n${[...new Set(coverage)].join('\n')}` : '')
    + (command.name === 'resource.list' ? '\n저장된 연결 상태는 현재 인증·작업 권한·서비스 상태를 검증한 결과가 아닙니다.' : '');
}
