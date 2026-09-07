import { HttpResponseArtifactSchema, isCompleteHttpPage } from '../../../contracts/artifacts/http-response.js';
import {
  normalizeReportHttpPath,
  ReportSourceCapturePlanSchema,
  type ReportHttpSourceSpec,
  type ReportSourceCapturePlan,
  type ReportSourceGateway,
} from './schema.js';

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

export interface ReportHttpProbeCorrection {
  alias: string;
  status: number;
  queryKeys: string[];
}

function probePath(spec: ReportHttpSourceSpec): string {
  const parsedPath = normalizeReportHttpPath(spec.path);
  const parsed = new URL(parsedPath, 'http://report-probe.invalid');
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

function probeStatus(error: unknown): number | undefined {
  const raw = error instanceof Error ? error.message : String(error);
  const match = /^report_http_probe_status:[^:]+:(\d{3})$/u.exec(raw);
  return match ? Number(match[1]) : undefined;
}

function hasRecoverableStaticQueryFailure(error: unknown): number | undefined {
  const status = probeStatus(error);
  return status === 400 || status === 422 ? status : undefined;
}

async function probeHttpSource(
  spec: ReportHttpSourceSpec,
  gateway: Pick<ReportSourceGateway, 'executeHttp'>,
): Promise<ReportHttpProbe> {
  const path = probePath(spec);
  const result = await gateway.executeHttp({
    ...(spec.connectionId ? { connectionId: spec.connectionId } : {}),
    method: 'GET',
    path,
  });
  const response = HttpResponseArtifactSchema.safeParse(result.data);
  if (!result.ok) {
    const connectorStatus = /^http_([45]\d{2})$/u.exec(result.error ?? '')?.[1];
    if (connectorStatus) throw new Error(`report_http_probe_status:${spec.alias}:${connectorStatus}`);
    if (response.success && response.data.status >= 400 && response.data.status <= 599) {
      throw new Error(`report_http_probe_status:${spec.alias}:${response.data.status}`);
    }
    throw new Error(`report_http_probe_failed:${spec.alias}:${result.errorCode ?? 'unknown'}`);
  }
  if (!response.success) throw new Error(`report_http_probe_response_invalid:${spec.alias}`);
  if (response.data.status < 200 || response.data.status >= 300) {
    throw new Error(`report_http_probe_status:${spec.alias}:${response.data.status}`);
  }
  if (!isCompleteHttpPage(response.data)) {
    throw new Error(`report_http_probe_incomplete:${spec.alias}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(response.data.body) as unknown;
  } catch {
    throw new Error(`report_http_probe_not_json:${spec.alias}`);
  }
  return { alias: spec.alias, path, status: response.data.status, shape: jsonShape(json) };
}

export async function probeReportHttpSources(
  input: ReportSourceCapturePlan,
  gateway: Pick<ReportSourceGateway, 'executeHttp'>,
): Promise<ReportHttpProbe[]> {
  const plan = ReportSourceCapturePlanSchema.parse(input);
  const probes: ReportHttpProbe[] = [];
  for (const spec of plan.http) {
    probes.push(await probeHttpSource(spec, gateway));
  }
  return probes;
}

/**
 * A model may add a server-side filter that is not part of an undocumented
 * endpoint's contract. A parameter-validation response is evidence that this
 * optimization is invalid, so retry the same authorized route once without
 * only that static filter. The corrected plan is returned to capture and
 * refinement; authentication, routing, transport, and server failures never
 * trigger this broadening retry.
 */
export async function probeReportHttpSourcesWithRecovery(
  input: ReportSourceCapturePlan,
  gateway: Pick<ReportSourceGateway, 'executeHttp'>,
): Promise<{
  plan: ReportSourceCapturePlan;
  probes: ReportHttpProbe[];
  corrections: ReportHttpProbeCorrection[];
}> {
  const plan = ReportSourceCapturePlanSchema.parse(input);
  const probes: ReportHttpProbe[] = [];
  const corrections: ReportHttpProbeCorrection[] = [];
  const http: ReportHttpSourceSpec[] = [];
  for (const source of plan.http) {
    try {
      probes.push(await probeHttpSource(source, gateway));
      http.push(source);
      continue;
    } catch (error) {
      const status = hasRecoverableStaticQueryFailure(error);
      const queryKeys = Object.keys(source.staticQuery ?? {}).sort();
      if (status === undefined || queryKeys.length === 0) throw error;
      const bareSource = { ...source };
      delete bareSource.staticQuery;
      let bareProbe: ReportHttpProbe;
      try {
        bareProbe = await probeHttpSource(bareSource, gateway);
      } catch {
        // Keep the original parameter failure as the actionable diagnosis. A
        // bare-path failure cannot make the source usable and must not be
        // hidden by a second, less specific error.
        throw error;
      }
      probes.push(bareProbe);
      http.push(bareSource);
      corrections.push({ alias: source.alias, status, queryKeys });
    }
  }
  return { plan: { ...plan, http }, probes, corrections };
}
