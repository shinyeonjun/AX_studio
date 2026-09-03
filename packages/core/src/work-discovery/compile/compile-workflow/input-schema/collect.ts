import type { TransformExpr } from '../../../../workflow/transform-expr/dsl.js';
import type { InputContractColumnType } from '../../../../contracts/output-contract.js';
import { sourceIdsInExpr } from '../helpers.js';

export function mergeColumnType(
  current: InputContractColumnType | undefined,
  next: InputContractColumnType,
): InputContractColumnType {
  if (!current || current === next) return next;
  return 'unknown';
}

function addColumnRequirement(
  bucket: Map<string, Map<string, InputContractColumnType>>,
  sourceId: string,
  name: string,
  type: InputContractColumnType,
): void {
  const columns = bucket.get(sourceId) ?? new Map<string, InputContractColumnType>();
  columns.set(name, mergeColumnType(columns.get(name), type));
  bucket.set(sourceId, columns);
}

function addColumnsForSources(
  bucket: Map<string, Map<string, InputContractColumnType>>,
  sourceIds: string[],
  names: string[],
  type: InputContractColumnType,
): void {
  for (const sourceId of sourceIds) {
    for (const name of names) addColumnRequirement(bucket, sourceId, name, type);
  }
}

function collectConditionColumns(
  condition: unknown,
  bucket: Map<string, Map<string, InputContractColumnType>>,
  sourceIds: string[],
): void {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) return;
  const record = condition as Record<string, unknown>;
  if (typeof record.ref === 'string') {
    addColumnsForSources(bucket, sourceIds, [record.ref], 'unknown');
  }
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') collectConditionColumns(value, bucket, sourceIds);
  }
}

export function collectInputColumns(
  expr: TransformExpr,
  bucket: Map<string, Map<string, InputContractColumnType>>,
  expectedType: InputContractColumnType = 'unknown',
): void {
  switch (expr.op) {
    case 'source':
      return;
    case 'column':
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), [expr.name], expectedType);
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'filter':
      collectConditionColumns(expr.where, bucket, sourceIdsInExpr(expr.input));
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'aggregate':
      if (expr.column) {
        addColumnsForSources(bucket, sourceIdsInExpr(expr.input), [expr.column], 'number');
      }
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'ratio':
      collectInputColumns(expr.numerator, bucket, 'number');
      collectInputColumns(expr.denominator, bucket, 'number');
      return;
    case 'lookup':
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), [expr.keyColumn], 'unknown');
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), [expr.valueColumn], expectedType);
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'select':
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), expr.columns, 'unknown');
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'sort':
      addColumnsForSources(bucket, sourceIdsInExpr(expr.input), expr.by.map((entry) => entry.column), 'unknown');
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
    case 'limit':
      collectInputColumns(expr.input, bucket, 'unknown');
      return;
  }
}

export function inputTypeForOutputKind(kind: string | undefined): InputContractColumnType {
  if (kind === 'number') return 'number';
  if (kind === 'text') return 'string';
  if (kind === 'date') return 'date';
  return 'unknown';
}
