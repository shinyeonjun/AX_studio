import { HttpResponseArtifactSchema } from '../../contracts/artifacts/http-response.js';
import {
  ReportSourceCapturePlanSchema,
  type ReportHttpSourceSpec,
  type ReportSourceCapturePlan,
  type ReportSourceGateway,
} from './schema.js';

const DUMMY_ORIGIN = 'http://report-probe.invalid';
const MAX_SHAPE_DEPTH = 8;
const MAX_OBJECT_KEYS = 200;

export type ReportJsonShape =
  | { type: 'null' | 'string' | 'number' | 'boolean' }
  | { type: 'array'; length: number; item?: ReportJsonShape }
  | { type: 'object'; fields: Record<string, ReportJsonShape> };

export interface ReportHttpProbe {
  alias: string;
  path: string;
  status: number;
  shape: ReportJsonShape;
}

function probePath(spec: ReportHttpSourceSpec): string {
  const raw = spec.path.trim();
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.includes('#')) {
    throw new Error(`report_http_path_invalid:${spec.alias}`);
  }
  const parsed = new URL(raw, DUMMY_ORIGIN);
  if (parsed.origin !== DUMMY_ORIGIN) throw new Error(`report_http_path_invalid:${spec.alias}`);
  for (const [key, value] of Object.entries(spec.staticQuery ?? {})) {
    parsed.searchParams.set(key, String(value));
  }
  return `${parsed.pathname}${parsed.search}`;
}

function jsonShape(value: unknown, depth = 0): ReportJsonShape {
  if (depth > MAX_SHAPE_DEPTH) throw new Error('report_http_probe_shape_too_deep');
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    const sample = value.find((item) => item !== null && item !== undefined);
    return {
      type: 'array',
      length: value.length,
      ...(sample === undefined ? {} : { item: jsonShape(sample, depth + 1) }),
    };
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length > MAX_OBJECT_KEYS) throw new Error('report_http_probe_shape_too_wide');
    return {
      type: 'object',
      fields: Object.fromEntries(entries.map(([key, child]) => [key, jsonShape(child, depth + 1)])),
    };
  }
  if (typeof value === 'string') return { type: 'string' };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  throw new Error('report_http_probe_json_invalid');
}

export async function probeReportHttpSources(
  input: ReportSourceCapturePlan,
  gateway: Pick<ReportSourceGateway, 'executeHttp'>,
): Promise<ReportHttpProbe[]> {
  const plan = ReportSourceCapturePlanSchema.parse(input);
  const probes: ReportHttpProbe[] = [];
  for (const spec of plan.http) {
    const path = probePath(spec);
    const result = await gateway.executeHttp({
      ...(spec.connectionId ? { connectionId: spec.connectionId } : {}),
      method: 'GET',
      path,
    });
    if (!result.ok) throw new Error(`report_http_probe_failed:${spec.alias}:${result.errorCode ?? 'unknown'}`);
    const response = HttpResponseArtifactSchema.safeParse(result.data);
    if (!response.success) throw new Error(`report_http_probe_response_invalid:${spec.alias}`);
    if (response.data.status < 200 || response.data.status >= 300) {
      throw new Error(`report_http_probe_status:${spec.alias}:${response.data.status}`);
    }
    if (response.data.truncated || response.data.completeness.status !== 'complete') {
      throw new Error(`report_http_probe_incomplete:${spec.alias}`);
    }
    let json: unknown;
    try {
      json = JSON.parse(response.data.body) as unknown;
    } catch {
      throw new Error(`report_http_probe_not_json:${spec.alias}`);
    }
    probes.push({ alias: spec.alias, path, status: response.data.status, shape: jsonShape(json) });
  }
  return probes;
}
