import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from './schema.js';
import { observationFromNumber } from './observe-document.js';

export function observeTableArtifact(exampleId: string, table: TableArtifact): OutputObservation[] {
  const observations: OutputObservation[] = [];
  const seen = new Set<string>();

  for (const row of table.rows) {
    for (const column of table.columns) {
      if (column.type !== 'number' && column.type !== 'integer' && column.type !== 'currency' && column.type !== 'percentage') {
        continue;
      }
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
