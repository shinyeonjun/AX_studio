import { TableArtifactSchema } from '../../contracts/artifacts/table.js';
import type {
  InputContractColumnType,
  OutputContract,
} from '../../contracts/output-contract.js';
import type {
  ContractCheckResult,
  OutputContractIssue,
} from './types.js';

function ok(): ContractCheckResult {
  return { ok: true, issues: [] };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}(?:$|[T ])/.test(value);
}

function inferColumnType(values: unknown[]): InputContractColumnType {
  const nonNull = values.filter((value) => value != null && String(value).trim() !== '');
  if (nonNull.length === 0) return 'unknown';
  if (nonNull.every((value) => typeof value === 'boolean')) return 'boolean';
  if (nonNull.every((value) => typeof value === 'number' && Number.isInteger(value))) return 'integer';
  if (nonNull.every((value) => typeof value === 'number' && Number.isFinite(value))) return 'number';
  const strings = nonNull.map(String);
  if (strings.every(isDateString)) return 'date';
  return strings.every((value) => /^-?\d[\d,]*(?:\.\d+)?$/.test(value.replace(/,/g, '')))
    ? 'number'
    : 'string';
}

export interface ActualInputColumn {
  name: string;
  type: InputContractColumnType;
}

/** Describes only source column names/types; row values never leave this seam. */
export function describeInputColumns(value: unknown): ActualInputColumn[] | undefined {
  const table = TableArtifactSchema.safeParse(value);
  if (table.success) {
    return table.data.columns.map((column) => ({ name: column.name, type: column.type }));
  }

  if (!Array.isArray(value)) return undefined;
  const rows = value.filter((entry): entry is Record<string, unknown> => Boolean(asRecord(entry)));
  if (rows.length === 0) return [];
  const names = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return names.map((name) => ({
    name,
    type: inferColumnType(rows.map((row) => row[name])),
  }));
}

function numericType(type: InputContractColumnType): boolean {
  return type === 'number' || type === 'integer' || type === 'currency' || type === 'percentage';
}

export function inputColumnTypesCompatible(
  expected: InputContractColumnType,
  actual: InputContractColumnType,
): boolean {
  if (expected === 'unknown' || actual === 'unknown') return true;
  if (expected === 'number') return numericType(actual);
  if (expected === 'integer') return actual === 'integer';
  if (expected === 'date') return actual === 'date' || actual === 'datetime';
  if (expected === 'datetime') return actual === 'datetime';
  return expected === actual;
}

/** Checks the columns produced by a source step, without inspecting row values. */
export function validateInputSchema(
  contract: OutputContract,
  stepId: string,
  data: unknown,
): ContractCheckResult {
  const schema = contract.inputSchemas.find((entry) => entry.stepId === stepId);
  if (!schema || schema.columns.length === 0) return ok();
  const columns = describeInputColumns(data);
  if (!columns) {
    return {
      ok: false,
      issues: [{
        code: 'source_unavailable',
        path: stepId,
        message: '입력 자료의 열 구조를 확인할 수 없습니다.',
        actual: 'table_schema_unavailable',
      }],
    };
  }

  const actualByName = new Map(columns.map((column) => [column.name, column.type]));
  const issues: OutputContractIssue[] = [];
  for (const expected of schema.columns) {
    const actual = actualByName.get(expected.name);
    if (!actual) {
      issues.push({
        code: 'schema_column_missing',
        path: expected.name,
        message: '입력 열을 찾을 수 없습니다: ' + expected.name,
        expected: expected.type,
        actual: 'column_not_present',
      });
      continue;
    }
    if (!inputColumnTypesCompatible(expected.type, actual)) {
      issues.push({
        code: 'schema_type_changed',
        path: expected.name,
        message: '입력 열 타입이 달라졌습니다: ' + expected.name,
        expected: expected.type,
        actual,
      });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : ok();
}
