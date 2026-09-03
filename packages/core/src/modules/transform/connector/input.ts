import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
import { TableArtifactSchema, type TableArtifact } from '../../../contracts/artifacts/table.js';

export function normalizeTableInput(value: unknown, sourceId: string): TableArtifact | undefined {
  const artifact = TableArtifactSchema.safeParse(value);
  if (artifact.success) return artifact.data;
  if (!Array.isArray(value)) return undefined;

  const rows = value.filter(
    (row): row is Record<string, unknown> =>
      Boolean(row) && typeof row === 'object' && !Array.isArray(row),
  );
  if (rows.length !== value.length) return undefined;

  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return buildTableArtifact({
    id: `runtime_${sourceId}`,
    headers,
    matrix: rows.map((row) => headers.map((header) => row[header])),
    source: sourceId.startsWith('rdb:') ? { table: sourceId.slice('rdb:'.length) } : undefined,
  });
}
