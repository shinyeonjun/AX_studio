import { ArtifactCompletenessSchema } from '../../../../../contracts/artifacts/completeness.js';
import type { AxCommand, AxCommandResult } from '../../schema.js';
import {
  HttpResponseArtifactSchema,
  httpResponseToTable,
} from '../../../../../contracts/artifacts/http-response.js';
import { TableArtifactSchema, type TableArtifact } from '../../../../../contracts/artifacts/table.js';
import { tableArtifactFromRows } from '../../../../../contracts/artifacts/table-build.js';
import { SEARCH_HITS_FIELD } from '../../../../../platform/knowledge.js';
import { uniqueObjectArrayPath } from '../../../../../connectors/http/connector/pagination.js';

export { uniqueObjectArrayPath };

export function httpResponseFromResult(result: AxCommandResult): ReturnType<typeof HttpResponseArtifactSchema.safeParse> {
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) {
    return HttpResponseArtifactSchema.safeParse(undefined);
  }
  const data = result.data as Record<string, unknown>;
  return HttpResponseArtifactSchema.safeParse(
    Object.hasOwn(data, 'data') ? data.data : data,
  );
}

export function selectedColumnsFromHttpPath(params: unknown): string[] | undefined {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return undefined;
  const record = params as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path.trim() : '';
  const queryStart = path.indexOf('?');
  if (queryStart < 0) return undefined;
  const select = new URLSearchParams(path.slice(queryStart + 1).split('#', 1)[0]).get('select');
  if (!select) return undefined;
  const columns = select.split(',').map((column) => column.trim());
  if (columns.length === 0 || columns.some((column) => !/^[A-Za-z_][A-Za-z0-9_.-]*$/u.test(column))) {
    return undefined;
  }
  return [...new Set(columns)];
}

/** How a chat HTTP read turns its response into a table: rows found in this body, columns from the path. */
export interface HttpTableConversion {
  rowsPath?: string;
  columns?: string[];
}

export function httpTableConversion(command: AxCommand, result: AxCommandResult): HttpTableConversion | undefined {
  if (command.name !== 'capability.invoke' || command.args.id !== 'http.request' || result.status !== 'ok') return undefined;
  const parsed = httpResponseFromResult(result);
  if (!parsed.success) return undefined;
  let json: unknown;
  try {
    json = JSON.parse(parsed.data.body) as unknown;
  } catch {
    return undefined;
  }
  const rowsPath = uniqueObjectArrayPath(json);
  const columns = selectedColumnsFromHttpPath(command.args.params);
  return { ...(rowsPath !== undefined ? { rowsPath } : {}), ...(columns ? { columns } : {}) };
}

function httpTableForTransform(command: AxCommand, result: AxCommandResult): TableArtifact | undefined {
  const parsed = httpResponseFromResult(result);
  const conversion = httpTableConversion(command, result);
  if (!parsed.success || !conversion) return undefined;
  const converted = httpResponseToTable(parsed.data, { sourceId: 'http:response', ...conversion });
  return converted.ok ? converted.table : undefined;
}

export function tableForJevTransform(command: AxCommand, result: AxCommandResult): TableArtifact | undefined {
  if (command.name !== 'capability.invoke' || result.status !== 'ok') return undefined;
  if (command.args.id === 'http.request') return httpTableForTransform(command, result);

  let payload = capabilityEnvelopeData(result);
  const table = TableArtifactSchema.safeParse(payload);
  if (table.success) return table.data;
  const page = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload as Record<string, unknown> : {};
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const body = (payload as Record<string, unknown>).body;
    if (typeof body === 'string') {
      try { payload = JSON.parse(body) as unknown; } catch { return undefined; }
    }
  }
  const rows = rowsForCapabilityTable(payload);
  const built = rows ? tableArtifactFromRows(rows, { id: 'chat:capability-result' }) : undefined;
  if (!built) return undefined;
  // A page of a larger set (20 of 300 files, 10 of the inbox) says so, in the chat and when
  // a later "몇 개야?" counts it.
  const completeness = ArtifactCompletenessSchema.safeParse(page.completeness);
  return {
    ...built,
    ...(page.truncated === true ? { truncated: true } : {}),
    ...(completeness.success ? { completeness: completeness.data } : {}),
  };
}

export function capabilityEnvelopeData(result: AxCommandResult): unknown {
  if (!result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return result.data;
  const envelope = result.data as Record<string, unknown>;
  return Object.hasOwn(envelope, 'data') ? envelope.data : envelope;
}

function objectRows(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.every((entry) => Boolean(entry) && typeof entry === 'object' && !Array.isArray(entry))
    ? value as Record<string, unknown>[]
    : undefined;
}

export function rowsForCapabilityTable(value: unknown): Record<string, unknown>[] | undefined {
  const direct = objectRows(value);
  if (direct) return direct;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  // A search result also carries its citations (hits); the rows people asked for are the other array.
  const candidates = Object.entries(value)
    .filter(([key, entry]) => key !== SEARCH_HITS_FIELD && objectRows(entry))
    .map(([, entry]) => entry);
  return candidates.length === 1 ? objectRows(candidates[0]) : undefined;
}
