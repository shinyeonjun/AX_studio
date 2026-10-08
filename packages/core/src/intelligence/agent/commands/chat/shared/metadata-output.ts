import type { AxCommand } from '../../schema.js';
import type { MetadataOutputKind, SourceMetadataEvidence } from '../../../../../contracts/request-understanding.js';
import { ContractTypeNameSchema } from '../../../../../contracts/capability-io.js';

/** Only an explicit output request can opt into raw metadata. This is syntax, not intent parsing. */
export function explicitlyRequestsRawMetadata(text: string): boolean {
  // Recognize complete affirmative format directives. Unknown continuations are
  // never accepted by a verb-prefix match or a growing list of refusal suffixes.
  const quoted = [...text.matchAll(/```[\s\S]*?```|`[^`]*`|"[^"]*"|'[^']*'|“[^”]*”|‘[^’]*’/gu)];
  const mentions = [...text.matchAll(/\b(?:(?:raw|debug)\s+)?json\b|원시\s*json|디버그\s*(?:용\s*)?json/giu)]
    .filter(mention => !quoted.some(quote => mention.index >= quote.index && mention.index < quote.index + quote[0].length));
  if (mentions.length !== 1) return false;
  const mention = mentions[0]!;
  const before = text.slice(0, mention.index);
  const after = text.slice(mention.index + mention[0].length);
  const koreanDirective = /^\s*(?:원문\s*)?(?:(?:으로|형태로|형식으로|그대로)\s*)?(?:보여(?:\s*(?:줘(?:요)?|주세요|주십시오|줄래(?:요)?))?|(?:출력|반환|표시)(?:해(?:\s*(?:줘(?:요)?|주세요|주십시오))?|하(?:세요|십시오))?)\s*[.!?。！？]*\s*$/u;
  const englishDirective = /^\s*(?:(?:please|(?:can|could|would)\s+you)\s+)?(?:show|print|output|return|render|provide|give|export|dump)\s+(?:(?:the\s+)?(?:(?:registered|saved)\s+)?(?:resources|metadata|inventory|schema|status)\s+)?(?:(?:as|in|using)\s+)?$/iu;
  const englishCompletion = /^\s*(?:(?:of|for)\s+(?:the\s+)?(?:(?:registered|saved)\s+)?(?:resources|metadata|inventory|schema|status)\s*)?(?:please\s*)?[.!?]*\s*$/iu;
  return koreanDirective.test(after) || (englishDirective.test(before) && englishCompletion.test(after));
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
  const localScope = evidence.scope === 'validated_local_registration'
    ? '\n이 PC에 저장된 목록만 확인했습니다. 서비스의 전체 목록이나 현재 권한을 확인한 것은 아닙니다.'
    : evidence.scope === 'registered_field_dictionary' ? '\n직접 정리해 둔 항목 구성입니다. 서비스의 실제 항목 구성을 확인한 것은 아닙니다.' : '';
  const filtered = evidence.filtered ? '\n안전하게 보여 드릴 수 없는 항목은 뺐습니다. 전체 목록이 아닙니다.' : '';
  const coverage = evidence.truncated || evidence.knownTotal === null || evidence.knownTotal > evidence.entries.length
    ? '\n등록된 정보의 일부이며, 원본 데이터 전체를 확인한 것은 아닙니다.'
    : '\n등록된 정보만 확인했습니다. 실제 자료는 가져오지 않았습니다.';
  if (evidence.intent === 'connection_status') {
    const status = evidence.status;
    if (!status) return `${label}: 연결 상태 정보가 없습니다.`;
    const authentication = { ready: '준비됨', not_ready: '준비 안 됨', unknown: '확인 안 됨' };
    const permission = { verified: '확인됨', denied: '거부됨', unknown: '확인 안 됨' };
    const health = { healthy: '정상', unhealthy: '문제 있음', unknown: '확인 안 됨' };
    return `${label} 연결 상태:\n- 서비스 목록: ${status.catalogExists ? '있음' : '없음'}\n`
      + `- 설정: ${status.configured ? '저장됨' : '저장 안 됨'}\n- 로그인 정보: ${authentication[status.authentication]}\n`
      + `- 작업 권한: ${permission[status.operationPermission]}\n- 현재 상태: ${health[status.health]}`
      + (status.enabled === undefined ? '' : `\n- 사용 설정: ${status.enabled ? '켜짐' : '꺼짐'}`) + localScope;
  }
  const title = evidence.intent === 'schema' ? evidence.scope === 'registered_field_dictionary' ? '저장된 항목 구성' : '항목 구성' : '등록된 자료 종류';
  const rows = evidence.entries.map(entry => `- ${inertMetadataText(entry.label || entry.id)}`
    + (entry.path ? ` — ${inertMetadataText(entry.path)}` : '')
    + (entry.fields?.length ? `: ${entry.fields.map(field => `${inertMetadataText(field.name)} (${field.type ? inertMetadataText(field.type) : '형식: 알 수 없음'}${evidence.scope === 'registered_field_dictionary' ? `, 필수: ${field.required === undefined ? '알 수 없음' : field.required ? '예' : '아니요'}` : ''})`).join(', ')}` : ''));
  return `${label} ${title}:\n${rows.length ? rows.join('\n') : evidence.truncated ? '지금 확인한 범위에서 보여 드릴 항목이 없습니다.' : '등록된 항목이 없습니다.'}${coverage}${localScope}${filtered}`;
}

interface MetadataView {
  fields: readonly string[];
  lists?: Readonly<Record<string, MetadataView>>;
  objects?: Readonly<Record<string, MetadataView>>;
  io?: boolean;
}
const PAGE_FIELDS = ['count', 'total', 'totalMatches', 'totalSources', 'totalTools', 'totalOperations', 'endpointCount', 'nextOffset', 'truncated'];
const IDENTITY_FIELDS = ['id', 'label', 'name', 'connector', 'kind', 'type', 'status', 'connected', 'connectable', 'availability'];
const FIELD_VIEW: MetadataView = { fields: ['name', 'label', 'type', 'format', 'nullable', 'required', 'in', 'description'] };
const ENTRY_VIEW: MetadataView = { fields: IDENTITY_FIELDS, lists: { fields: FIELD_VIEW, columns: FIELD_VIEW, params: FIELD_VIEW } };
const RESPONSE_VIEW: MetadataView = { fields: ['status', 'description', 'required'], lists: { fields: FIELD_VIEW } };
const OPERATION_VIEW: MetadataView = { fields: [...IDENTITY_FIELDS, 'operationId', 'method', 'path', 'summary', 'sideEffect'],
  lists: { params: FIELD_VIEW, parameters: FIELD_VIEW, responses: RESPONSE_VIEW }, objects: { requestBody: RESPONSE_VIEW } };
const CAPABILITY_VIEW: MetadataView = { ...ENTRY_VIEW, fields: [...IDENTITY_FIELDS, 'available', 'reason', 'sideEffect'], io: true };
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
  if (view.io && record.io && typeof record.io === 'object' && !Array.isArray(record.io)) {
    const io = record.io as Record<string, unknown>;
    const approvedIO: Record<string, Record<string, string>> = {};
    for (const direction of ['inputs', 'outputs']) {
      const ports = io[direction];
      if (!ports || typeof ports !== 'object' || Array.isArray(ports)) {
        approvedIO[direction] = {};
        if (ports !== undefined) result.truncated = true;
        continue;
      }
      const entries = Object.entries(ports);
      const approvedPorts = entries.slice(0, 32).flatMap(([name, contract]) => {
        const type = ContractTypeNameSchema.safeParse(contract);
        return name.length <= 160 && type.success ? [[name, type.data]] : [];
      });
      approvedIO[direction] = Object.fromEntries(approvedPorts);
      if (approvedPorts.length !== entries.length) result.truncated = true;
    }
    result.io = approvedIO;
  }
  return result;
}

export function renderCatalogMetadata(command: AxCommand, data: unknown, raw: boolean): string {
  const view = COMMAND_VIEWS[command.name];
  const approved = view ? approvedMetadata(data, view) : {};
  const named = (entry: Record<string, unknown>) => [entry.label, entry.fileName, entry.name, entry.title, entry.operationId, entry.id, entry.connector, entry.table]
    .find(value => typeof value === 'string') as string | undefined;
  const sections = (entry: Record<string, unknown>): Record<string, unknown>[] => Object.entries(entry).flatMap(([key, value]) =>
    key === 'io' ? [] : Array.isArray(value) ? value : value && typeof value === 'object' ? [value as Record<string, unknown>] : []);
  // Paging counters alone do not establish a recognized collection, much less an empty one.
  if (!named(approved) && !sections(approved).length && !Object.values(approved).some(Array.isArray)) {
    return '보여 드릴 정보의 형식을 확인하지 못했습니다. 연결 설정을 확인해 주세요.';
  }
  if (raw) return jsonFence(approved);
  const titles: Partial<Record<AxCommand['name'], string>> = {
    'resource.list': '연결된 서비스와 자료', 'source.list': '등록된 자료', 'source.files.list': '등록된 파일',
    'session.source.list': '이 대화의 자료', 'capability.list': '할 수 있는 작업', 'capability.describe': '작업 정보',
    'discovery.search': '찾은 자료와 작업', 'discovery.describe': '자료 정보',
  };
  const lines: string[] = [];
  const coverage: string[] = [];
  const visit = (entry: Record<string, unknown>) => {
    const name = named(entry);
    const details = ['type', 'kind', 'status', 'availability', 'method', 'path', 'reason', 'description'].flatMap(key =>
      typeof entry[key] === 'string' ? [inertMetadataText(entry[key] as string)] : []);
    if (typeof entry.connected === 'boolean') details.push(`연결: ${entry.connected ? '연결됨' : '연결 안 됨'}`);
    if (typeof entry.available === 'boolean') details.push(`사용 준비: ${entry.available ? '됨' : '안 됨'}`);
    if (typeof entry.required === 'boolean') details.push(entry.required ? '필수' : '선택');
    if (name) lines.push(`- ${inertMetadataText(name)}${typeof entry.name === 'string' && entry.name !== name ? ` (${inertMetadataText(entry.name)})` : ''}`
      + (details.length ? ` — ${details.join(', ')}` : ''));
    if (entry.io) {
      const io = entry.io as Record<string, Record<string, string>>;
      for (const [direction, title] of [['inputs', '입력'], ['outputs', '출력']]) {
        for (const [port, type] of Object.entries(io[direction!] ?? {})) lines.push(`- ${title} ${inertMetadataText(port)}: ${inertMetadataText(type)}`);
      }
    }
    if (entry.truncated === true || typeof entry.nextOffset === 'number') coverage.push('목록의 일부만 보여 드렸습니다.'
      + (typeof entry.nextOffset === 'number' ? ` ${entry.nextOffset + 1}번째 항목부터 이어서 볼 수 있습니다.` : ''));
    for (const key of ['totalMatches', 'total', 'totalSources', 'totalTools', 'totalOperations', 'endpointCount']) {
      if (typeof entry[key] === 'number') coverage.push(`전체 개수 (${name ? inertMetadataText(name) : key}): ${entry[key]}개.`);
    }
    sections(entry).forEach(visit);
  };
  visit(approved);
  const total = ['totalMatches', 'total', 'totalSources', 'totalTools', 'totalOperations', 'endpointCount', 'count']
    .map(key => approved[key]).find(value => typeof value === 'number');
  const incomplete = approved.truncated === true || typeof approved.nextOffset === 'number';
  const empty = total === 0 && !incomplete ? '등록된 항목이 없습니다.' : '이번 목록에 보여 드릴 항목이 없습니다.';
  return `${titles[command.name] ?? '자료 정보'}:\n${lines.length ? lines.join('\n') : sections(approved).length ? '보여 드릴 이름이 없습니다.' : empty}`
    + (coverage.length ? `\n${[...new Set(coverage)].join('\n')}` : '')
    + (command.name === 'resource.list' ? '\n저장된 설정만 확인했어요. 실제로 접속되는지는 확인하지 않았어요.' : '');
}
