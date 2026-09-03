import { TableArtifactSchema, type TableArtifact } from '../../contracts/artifacts/table.js';
import type { RepairCandidateOperation } from '../../workflow/repair.js';

export function renameHistoricalTable(
  table: TableArtifact,
  candidate: RepairCandidateOperation,
): TableArtifact | null {
  const fromColumn = table.columns.some((column) => column.name === candidate.from);
  if (!fromColumn) return table;
  if (table.columns.some((column) => column.name === candidate.to)) return null;
  const columns = table.columns.map((column) =>
    column.name === candidate.from ? { ...column, name: candidate.to } : column);
  const rows = table.rows.map((row) => {
    const { [candidate.from]: fromValue, ...rest } = row.values;
    return { ...row, values: { ...rest, [candidate.to]: fromValue ?? null } };
  });
  const profile = table.profile
    ? {
      ...table.profile,
      columns: Object.fromEntries(Object.entries(table.profile.columns).map(([name, value]) =>
        name === candidate.from ? [candidate.to, value] : [name, value])),
    }
    : undefined;
  return TableArtifactSchema.parse({ ...table, columns, rows, ...(profile ? { profile } : {}) });
}
