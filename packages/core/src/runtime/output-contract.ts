import { TableArtifactSchema } from '../contracts/artifacts/table.js';
import type {
  InputContractColumnType,
  OutputContract,
  OutputContractValueKind,
} from '../contracts/output-contract.js';

export const OUTPUT_CONTRACT_FAILURE_CODES = [
  'source_unavailable',
  'schema_column_missing',
  'schema_type_changed',
  'output_section_missing',
  'output_type_changed',
  'output_volume_anomaly',
] as const;

export type OutputContractIssueCode = (typeof OUTPUT_CONTRACT_FAILURE_CODES)[number];

/** A safe, payload-free explanation suitable for persisted execution logs. */
export interface OutputContractIssue {
  code: OutputContractIssueCode;
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export type ContractCheckResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: OutputContractIssue[] };

export interface ContractFailureData {
  phase: string;
  issues: OutputContractIssue[];
}

export type ContractFailure = Error & {
  code: 'input_schema_drift' | 'output_contract_failed';
  data: ContractFailureData;
};

function ok(): ContractCheckResult {
  return { ok: true, issues: [] };
}

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

function resolveOutputValue(
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

function outputValueKind(value: unknown): OutputContractValueKind | undefined {
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
        message: `입력 열을 찾을 수 없습니다: ${expected.name}`,
        expected: expected.type,
        actual: 'column_not_present',
      });
      continue;
    }
    if (!inputColumnTypesCompatible(expected.type, actual)) {
      issues.push({
        code: 'schema_type_changed',
        path: expected.name,
        message: `입력 열 타입이 달라졌습니다: ${expected.name}`,
        expected: expected.type,
        actual,
      });
    }
  }
  return issues.length > 0 ? { ok: false, issues } : ok();
}

function rowCount(value: unknown): number | undefined {
  const table = TableArtifactSchema.safeParse(value);
  if (table.success) return table.data.rows.length;
  if (Array.isArray(value)) return value.length;
  const record = asRecord(value);
  return Array.isArray(record?.rows) ? record.rows.length : undefined;
}

function rangeText(min: number, max: number, ratio: number): string {
  return `${min}..${max} ± ${Math.round(ratio * 100)}%`;
}

function rangeContains(value: number, min: number, max: number, ratio: number): boolean {
  const padding = Math.max(Math.abs(min), Math.abs(max), 1) * ratio;
  return value >= min - padding && value <= max + padding;
}

/** Checks required output sections, types, and multi-sample volume ranges. */
export function validateOutputContract(
  contract: OutputContract,
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): ContractCheckResult {
  const issues: OutputContractIssue[] = [];
  for (const field of contract.fields) {
    const value = resolveOutputValue(field.path, variables, stepResults);
    if (value == null) {
      if (field.required) {
        issues.push({
          code: 'output_section_missing',
          path: field.path,
          message: `필수 결과가 없습니다: ${field.path}`,
          expected: field.kind,
          actual: 'missing',
        });
      }
      continue;
    }

    const actualKind = outputValueKind(value);
    if (actualKind !== field.kind) {
      issues.push({
        code: 'output_type_changed',
        path: field.path,
        message: `결과 타입이 달라졌습니다: ${field.path}`,
        expected: field.kind,
        actual: actualKind ?? 'unknown',
      });
      continue;
    }

    if (
      field.kind === 'number' &&
      field.baseline.sampleCount >= 2 &&
      field.baseline.numericMin !== undefined &&
      field.baseline.numericMax !== undefined &&
      typeof value === 'number'
    ) {
      const ratio = field.baseline.numericToleranceRatio ?? 0.2;
      if (!rangeContains(value, field.baseline.numericMin, field.baseline.numericMax, ratio)) {
        issues.push({
          code: 'output_volume_anomaly',
          path: field.path,
          message: `수치가 기준 범위를 벗어났습니다: ${field.path}`,
          expected: rangeText(field.baseline.numericMin, field.baseline.numericMax, ratio),
          actual: 'number_outside_baseline_range',
        });
      }
    }

    if (
      field.kind === 'table' &&
      field.baseline.sampleCount >= 2 &&
      field.baseline.rowCountMin !== undefined &&
      field.baseline.rowCountMax !== undefined
    ) {
      const actualRows = rowCount(value);
      const ratio = field.baseline.rowCountToleranceRatio ?? 0.2;
      if (actualRows !== undefined && !rangeContains(actualRows, field.baseline.rowCountMin, field.baseline.rowCountMax, ratio)) {
        issues.push({
          code: 'output_volume_anomaly',
          path: field.path,
          message: `결과 행 수가 기준 범위를 벗어났습니다: ${field.path}`,
          expected: rangeText(field.baseline.rowCountMin, field.baseline.rowCountMax, ratio),
          actual: 'row_count_outside_baseline_range',
        });
      }
    }
  }
  return issues.length > 0 ? { ok: false, issues } : ok();
}

export function createContractFailure(
  code: ContractFailure['code'],
  phase: string,
  result: Extract<ContractCheckResult, { ok: false }>,
): ContractFailure {
  const message = code === 'input_schema_drift'
    ? '입력 자료의 스키마가 과거 기준과 달라 실행을 중단했습니다.'
    : '실행 결과가 과거 기준과 달라 외부 발송을 중단했습니다.';
  return Object.assign(new Error(message), {
    code,
    data: { phase, issues: result.issues },
  });
}

export function isContractFailure(error: unknown): error is ContractFailure {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return (record.code === 'input_schema_drift' || record.code === 'output_contract_failed') &&
    Boolean(record.data && typeof record.data === 'object');
}
