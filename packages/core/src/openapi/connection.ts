import { performHttpRequest } from '../modules/http/request.js';
import { parseOpenApiSpec } from './parse.js';

export interface OpenApiConnectionRecord {
  specId?: string;
  label?: string;
  baseUrl?: string;
  specUrl?: string;
  specJson?: unknown;
  connectedAt?: string;
  lastError?: string;
  operationCount?: number;
}

export interface OpenApiConnectionConfig {
  specId: string;
  label?: string;
  baseUrl: string;
  specJson: unknown;
}

export function parseOpenApiConnectionConfig(config: unknown): OpenApiConnectionConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const record = config as OpenApiConnectionRecord;
  const specId = typeof record.specId === 'string' ? record.specId.trim() : '';
  const baseUrl = typeof record.baseUrl === 'string' ? record.baseUrl.trim() : '';
  if (!specId || !baseUrl || record.specJson === undefined) return null;
  return {
    specId,
    label: typeof record.label === 'string' ? record.label.trim() || undefined : undefined,
    baseUrl,
    specJson: record.specJson,
  };
}

export async function loadOpenApiSpecFromUrl(specUrl: string): Promise<unknown> {
  const url = specUrl.trim();
  if (!url) throw new Error('OpenAPI spec URL이 필요합니다.');
  const result = await performHttpRequest({ url, method: 'GET', maxBytes: 2_000_000 });
  if (!result.ok) {
    throw new Error(result.error === 'connection_timeout' ? 'spec URL 연결 시간 초과' : 'spec URL을 가져올 수 없습니다.');
  }
  try {
    return JSON.parse(result.body ?? '');
  } catch {
    throw new Error('OpenAPI spec JSON 파싱에 실패했습니다.');
  }
}

export function validateOpenApiSpecJson(specId: string, raw: unknown): { specId: string; baseUrl: string; operationCount: number } {
  const spec = parseOpenApiSpec(specId, raw);
  return { specId: spec.id, baseUrl: spec.baseUrl, operationCount: spec.operations.length };
}
