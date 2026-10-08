import { tableArtifactFromMatrix, tableArtifactFromRows } from '../../../contracts/artifacts/table-build.js';
import { parseRdbSourceId } from '../../../contracts/rdb-source-id.js';
import { TableArtifactSchema, type TableArtifact } from '../../../contracts/artifacts/table.js';

export function normalizeTableInput(value: unknown, sourceId: string): TableArtifact | undefined {
  const artifact = TableArtifactSchema.safeParse(value);
  if (artifact.success) return artifact.data;
  if (!Array.isArray(value)) return undefined;

  return tableArtifactFromRows(value, {
    id: `runtime_${sourceId}`,
    source: parseRdbSourceId(sourceId) ? { table: parseRdbSourceId(sourceId)!.table } : undefined,
  }) ?? tableArtifactFromMatrix(value, {
    id: `runtime_${sourceId}`,
    source: parseRdbSourceId(sourceId) ? { table: parseRdbSourceId(sourceId)!.table } : undefined,
  });
}
