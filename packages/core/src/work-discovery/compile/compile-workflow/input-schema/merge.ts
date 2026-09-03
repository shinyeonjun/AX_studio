import type { InputContract } from '../../../../contracts/output-contract.js';
import { mergeColumnType } from './collect.js';

export function mergeInputSchemas(
  existing: InputContract[],
  generated: InputContract[],
): InputContract[] {
  const merged = new Map<string, InputContract>();
  for (const schema of [...existing, ...generated]) {
    const key = schema.sourceId + '\0' + schema.stepId;
    const previous = merged.get(key);
    if (!previous) {
      merged.set(key, schema);
      continue;
    }
    const columns = new Map(previous.columns.map((column) => [column.name, column.type]));
    for (const column of schema.columns) {
      columns.set(column.name, mergeColumnType(columns.get(column.name), column.type));
    }
    merged.set(key, {
      ...previous,
      columns: [...columns.entries()].map(([name, type]) => ({ name, type })),
    });
  }
  return [...merged.values()];
}
