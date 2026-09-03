import type { OutputContract } from '../../../contracts/output-contract.js';
import type {
  ContractCheckResult,
  OutputContractIssue,
} from '../types.js';
import { rangeContains, rangeText } from './range.js';
import { outputValueKind, resolveOutputValue, rowCount } from './value.js';

function ok(): ContractCheckResult {
  return { ok: true, issues: [] };
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
          message: '필수 결과가 없습니다: ' + field.path,
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
        message: '결과 타입이 달라졌습니다: ' + field.path,
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
          message: '수치가 기준 범위를 벗어났습니다: ' + field.path,
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
          message: '결과 행 수가 기준 범위를 벗어났습니다: ' + field.path,
          expected: rangeText(field.baseline.rowCountMin, field.baseline.rowCountMax, ratio),
          actual: 'row_count_outside_baseline_range',
        });
      }
    }
  }
  return issues.length > 0 ? { ok: false, issues } : ok();
}
