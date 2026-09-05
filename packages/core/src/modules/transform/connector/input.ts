import { tableArtifactFromMatrix, tableArtifactFromRows } from '../../../contracts/artifacts/table-build.js';
import { TableArtifactSchema, type TableArtifact } from '../../../contracts/artifacts/table.js';

export function normalizeTableInput(value: unknown, sourceId: string): TableArtifact | undefined {
  const artifact = TableArtifactSchema.safeParse(value);
  if (artifact.success) return artifact.data;
  if (!Array.isArray(value)) return undefined;

  return tableArtifactFromRows(value, {
    id: `runtime_${sourceId}`,
    source: sourceId.startsWith('rdb:') ? { table: sourceId.slice('rdb:'.length) } : undefined,
  }) ?? tableArtifactFromMatrix(value, {
    id: `runtime_${sourceId}`,
    source: sourceId.startsWith('rdb:') ? { table: sourceId.slice('rdb:'.length) } : undefined,
  });
}
