import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ArtifactCompletenessSchema,
  completeArtifactCompleteness,
  partialArtifactCompleteness,
} from './completeness.js';
import { buildTableArtifact } from './table-build.js';
import { TableArtifactSchema, type TableArtifact } from './table.js';

export const HttpResponseArtifactSchema = z.object({
  id: z.string(),
  kind: z.literal('http_response'),
  status: z.number().int().nonnegative(),
  statusText: z.string(),
  headers: z.record(z.string()),
  body: z.string(),
  url: z.string(),
  truncated: z.boolean().default(false),
  contentType: z.string().optional(),
  completeness: ArtifactCompletenessSchema,
});

export type HttpResponseArtifact = z.infer<typeof HttpResponseArtifactSchema>;

export function buildHttpResponseArtifact(input: {
  executionId: string;
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  truncated: boolean;
}): HttpResponseArtifact {
  const id = `http_${createHash('sha256')
    .update(`${input.executionId}\0${input.url}\0${input.status}\0${input.body}`)
    .digest('hex')
    .slice(0, 24)}`;
  const contentType = Object.entries(input.headers).find(([key]) => key.toLowerCase() === 'content-type')?.[1];
  const completeness = input.truncated
    ? partialArtifactCompleteness('response_byte_limit', { hasMore: true })
    : completeArtifactCompleteness(input.body.length);
  return HttpResponseArtifactSchema.parse({
    id,
    kind: 'http_response',
    status: input.status,
    statusText: input.statusText,
    headers: input.headers,
    body: input.body,
    url: input.url,
    truncated: input.truncated,
    contentType,
    completeness,
  });
}

function readPath(value: unknown, path: string): unknown {
  let current = value;
  for (const segment of path.split('.')) {
    if (!segment || !current || typeof current !== 'object' || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function isRow(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function rowsAtPath(value: unknown, rowsPath?: string):
  | { ok: true; rows: Record<string, unknown>[] }
  | { ok: false; errorCode: string } {
  const selected = rowsPath?.trim() ? readPath(value, rowsPath.trim()) : value;
  if (!Array.isArray(selected)) {
    return { ok: false, errorCode: rowsPath ? 'http_rows_path_not_array' : 'http_rows_path_required' };
  }
  if (!selected.every(isRow)) return { ok: false, errorCode: 'http_rows_not_objects' };
  return { ok: true, rows: selected };
}

/**
 * Convert a JSON HTTP response into a table only with an explicit row path
 * when the root is not already an array. This keeps response-shape decisions
 * deterministic instead of guessing which nested array the model intended.
 */
export function httpResponseToTable(
  response: HttpResponseArtifact,
  options: { sourceId: string; rowsPath?: string; rowLimit?: number },
): { ok: true; table: TableArtifact } | { ok: false; errorCode: string } {
  const parsed = HttpResponseArtifactSchema.safeParse(response);
  if (!parsed.success) return { ok: false, errorCode: 'http_response_invalid' };

  let json: unknown;
  try {
    json = JSON.parse(parsed.data.body) as unknown;
  } catch {
    return { ok: false, errorCode: 'http_response_not_json' };
  }

  const rows = rowsAtPath(json, options.rowsPath);
  if (!rows.ok) return rows;
  const headers = [...new Set(rows.rows.flatMap((row) => Object.keys(row)))];
  const table = buildTableArtifact({
    id: `table_${parsed.data.id}_${options.sourceId}`,
    name: options.sourceId,
    headers,
    matrix: rows.rows.map((row) => headers.map((header) => row[header])),
    rowLimit: options.rowLimit,
    source: {
      queryFingerprint: parsed.data.id,
      capturedAt: new Date().toISOString(),
    },
  });

  if (parsed.data.truncated) {
    table.truncated = true;
    table.completeness = partialArtifactCompleteness('response_byte_limit', {
      observedCount: table.rows.length,
      limit: options.rowLimit,
      hasMore: true,
    });
  }
  return { ok: true, table: TableArtifactSchema.parse(table) };
}
