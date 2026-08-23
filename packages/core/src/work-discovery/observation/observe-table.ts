import { randomUUID } from 'node:crypto';
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

export function observeTableSummaryArtifact(exampleId: string, table: TableArtifact, labels: Record<string, string>): OutputObservation[] {
  const observations: OutputObservation[] = [];
  for (const [path, label] of Object.entries(labels)) {
    const columnName = label;
    const numbers = table.rows
      .map((row) => row.values[columnName])
      .filter((value): value is number => typeof value === 'number');
    if (numbers.length === 0) continue;
    const sum = numbers.reduce((total, value) => total + value, 0);
    observations.push({
      id: `obs_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      exampleId,
      path,
      label,
      value: { kind: 'number', value: sum, display: String(sum) },
      role: 'dynamic_value',
      required: true,
    });
  }
  return observations;
}
