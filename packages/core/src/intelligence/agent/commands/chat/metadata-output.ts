import type { AxCommand } from '../schema.js';
import type { MetadataOutputKind, SourceMetadataEvidence } from '../../../../contracts/request-understanding.js';

/** Only an explicit output request can opt into raw metadata. This is syntax, not intent parsing. */
export function explicitlyRequestsRawMetadata(text: string): boolean {
  return /\b(?:raw|debug)\s+json\b|원시\s*json|json\s*(?:원문|그대로|으로\s*(?:보여|출력))|디버그\s*(?:용\s*)?json/iu.test(text);
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

const PUBLIC_FIELDS = ['id', 'label', 'name', 'connector', 'kind', 'type', 'status', 'connected', 'connectable', 'nullable'] as const;
const PUBLIC_LISTS = ['resources', 'sources', 'files', 'capabilities', 'assets', 'hits', 'items', 'fields', 'columns', 'params'] as const;

/** Legacy metadata commands use a bounded allowlist too; debug never dumps arbitrary envelopes. */
function approvedMetadata(value: unknown, depth = 0): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return {};
  const record = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const key of PUBLIC_FIELDS) {
    const item = record[key];
    if (typeof item === 'string') result[key] = item.slice(0, 160);
    else if (typeof item === 'boolean') result[key] = item;
  }
  for (const key of PUBLIC_LISTS) {
    if (Array.isArray(record[key])) result[key] = record[key].slice(0, 64).map(item => approvedMetadata(item, depth + 1));
  }
  if (record.asset && typeof record.asset === 'object') result.asset = approvedMetadata(record.asset, depth + 1);
  for (const key of ['count', 'totalMatches', 'nextOffset'] as const) {
    if (Number.isSafeInteger(record[key]) && (record[key] as number) >= 0) result[key] = record[key];
  }
  if (record.truncated === true || PUBLIC_LISTS.some(key => Array.isArray(record[key]) && record[key].length > 64)
    || PUBLIC_LISTS.some(key => Array.isArray(result[key]) && result[key].some(item => item.truncated === true))) result.truncated = true;
  return result;
}

export function renderCatalogMetadata(command: AxCommand, data: unknown, raw: boolean): string {
  const approved = approvedMetadata(data);
  if (raw) return jsonFence(approved);
  if (Object.keys(approved).length === 0) return '표시할 메타데이터 형식을 확인하지 못했습니다. 등록된 명세를 확인해 주세요.';
  const titles: Partial<Record<AxCommand['name'], string>> = {
    'resource.list': '등록된 리소스', 'source.list': '등록된 자료', 'source.files.list': '등록된 파일',
    'session.source.list': '현재 대화 자료', 'capability.list': '등록된 도구', 'capability.describe': '도구 정보',
    'discovery.search': '등록된 데이터·도구', 'discovery.describe': '등록된 메타데이터',
  };
  const rows = PUBLIC_LISTS.flatMap(key => Array.isArray(approved[key]) ? approved[key] as Record<string, unknown>[] : []);
  const entries = rows.length ? rows : Object.keys(approved).some(key => PUBLIC_FIELDS.includes(key as typeof PUBLIC_FIELDS[number]))
    ? [approved] : approved.asset && typeof approved.asset === 'object' ? [approved.asset as Record<string, unknown>] : [];
  const lines = entries.map(entry => {
    const name = [entry.label, entry.name, entry.id].find(value => typeof value === 'string') as string | undefined;
    if (!name) return undefined;
    const details = ['type', 'kind', 'status'].flatMap(key => typeof entry[key] === 'string' ? [inertMetadataText(entry[key] as string)] : []);
    const fields = ['fields', 'columns', 'params'].flatMap(key => Array.isArray(entry[key])
      ? (entry[key] as Record<string, unknown>[]).flatMap(field => typeof field.name === 'string'
        ? [`${inertMetadataText(field.name)}${typeof field.type === 'string' ? ` (${inertMetadataText(field.type)})` : ''}`] : []) : []);
    if (typeof entry.connected === 'boolean') details.push(`저장된 연결 상태: ${entry.connected ? '연결됨' : '연결 안 됨'}`);
    return `- ${inertMetadataText(name)}${details.length ? ` — ${details.join(', ')}` : ''}${fields.length ? `: ${fields.join(', ')}` : ''}`;
  }).filter(Boolean);
  const incomplete = approved.truncated === true || typeof approved.nextOffset === 'number';
  return `${titles[command.name] ?? '메타데이터'}:\n${lines.length ? lines.join('\n') : rows.length ? '표시할 메타데이터 이름이 없습니다.' : '등록된 항목이 없습니다.'}`
    + (incomplete ? '\n현재 카탈로그의 일부만 표시했습니다.' : '')
    + (command.name === 'resource.list' ? '\n저장된 연결 상태는 현재 인증·작업 권한·서비스 상태를 검증한 결과가 아닙니다.' : '');
}
