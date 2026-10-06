import { randomUUID } from 'node:crypto';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from './schema.js';
import { observationFromNumber, slugifyLabel } from './observe-document.js';
import { tableKeyColumn } from './table-key.js';

type TableCell = string | number | boolean | null;

function isNumericColumn(column: TableArtifact['columns'][number]): boolean {
  return column.type === 'number' || column.type === 'integer' || column.type === 'currency' || column.type === 'percentage';
}

/**
 * A multi-row table whose rows are identified by a distinct text column is one report table
 * (e.g. one row per category): observe it whole instead of as colliding per-cell numbers.
 */
function observeWholeTable(exampleId: string, table: TableArtifact): OutputObservation | undefined {
  const columns = table.columns.map((column) => column.name);
  // Readers keep blank worksheet rows for provenance; they are not report rows.
  const rows = table.rows
    .filter((row) => columns.some((column) => {
      const value = row.values[column];
      return value != null && String(value).trim() !== '';
    }))
    .map((row) => Object.fromEntries(columns.map((column) => [column, (row.values[column] ?? null) as TableCell])));
  if (rows.length < 2 || !table.columns.some(isNumericColumn)) return undefined;
  if (!tableKeyColumn({ columns, rows })) return undefined;
  const label = table.name?.trim() || table.id;
  return {
    id: `obs_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    exampleId,
    path: slugifyLabel(label),
    label,
    value: { kind: 'table', columns, rows },
    role: 'dynamic_value',
    required: true,
  };
}

export function observeTableArtifact(exampleId: string, table: TableArtifact): OutputObservation[] {
  const whole = observeWholeTable(exampleId, table);
  if (whole) return [whole];
  const observations: OutputObservation[] = [];
  const seen = new Set<string>();
  for (const row of table.rows) {
    for (const column of table.columns) {
      if (!isNumericColumn(column)) continue;
      const value = row.values[column.name];
      if (typeof value !== 'number') continue;
      const label = column.label ?? column.name;
      const key = `${label}:${value}`;
      if (seen.has(key)) continue;
      const observation = observationFromNumber(exampleId, label, String(value));
      if (!observation) continue;
      seen.add(key);
      observations.push(observation);
    }
  }
  return observations;
}
