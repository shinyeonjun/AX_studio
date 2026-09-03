import { TableArtifactSchema } from '../../../contracts/artifacts/table.js';
import type { OutputContractValueKind } from '../../../contracts/output-contract.js';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function nestedValue(record: Record<string, unknown>, path: string): unknown {
  if (hasOwn(record, path)) return record[path];
  const parts = path.split('.');
  let current: unknown = record;
  for (const part of parts) {
    const currentRecord = asRecord(current);
    if (!currentRecord || !hasOwn(currentRecord, part)) return undefined;
    current = currentRecord[part];
  }
  return current;
}

export function resolveOutputValue(
  path: string,
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): unknown {
  const discoveryFields = asRecord(variables.discoveryFields);
  if (discoveryFields) {
    const value = nestedValue(discoveryFields, path);
    if (value !== undefined) return value;
  }
  const direct = nestedValue(variables, path);
  if (direct !== undefined) return direct;
  for (const result of Object.values(stepResults)) {
    const record = asRecord(result);
    if (record?.outputPath === path && hasOwn(record, 'value')) return record.value;
  }
  return undefined;
}

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value);
}

export function outputValueKind(value: unknown): OutputContractValueKind | undefined {
  if (value == null) return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? 'number' : undefined;
  if (typeof value === 'string') return isDateString(value) ? 'date' : 'text';
  if (Array.isArray(value)) {
    return value.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry))
      ? 'table'
      : 'list';
  }
  const table = TableArtifactSchema.safeParse(value);
  if (table.success) return 'table';
  const record = asRecord(value);
  if (typeof record?.artifactId === 'string') return 'image';
  return undefined;
}

export function rowCount(value: unknown): number | undefined {
  const table = TableArtifactSchema.safeParse(value);
  if (table.success) return table.data.rows.length;
  if (Array.isArray(value)) return value.length;
  const record = asRecord(value);
  return Array.isArray(record?.rows) ? record.rows.length : undefined;
}
