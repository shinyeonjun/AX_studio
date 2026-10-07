import type { OutputObservation } from './observation/schema.js';
import type { DiscoverySessionState } from './schema.js';
import type { TransformExpr } from '../workflow/transform-expr/dsl.js';
import { describeMapping } from './describe-expr.js';

export const AUTO_RESUME_STATUSES: ReadonlySet<DiscoverySessionState['status']> = new Set([
  'collecting_examples',
  'observing_output',
  'inventory_sources',
  'exploring_sources',
  'synthesizing',
  'validating',
]);

/** Numbers without the report's own formatting get thousands separators (10479300 -> 10,479,300). */
export function displayNumber(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toLocaleString('ko-KR', { maximumFractionDigits: 6 })
    : String(value ?? '');
}

/** Compact text for a replayed value: tables are summarized, never dumped. */
export function displayValue(value: unknown): string {
  if (value && typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows)) {
    return `${(value as { rows: unknown[] }).rows.length}행 표`;
  }
  // Large replayed tables are persisted as a row count only.
  if (value && typeof value === 'object' && typeof (value as { rowCount?: unknown }).rowCount === 'number') {
    return `${(value as { rowCount: number }).rowCount}행 표`;
  }
  return displayNumber(value);
}

export function observationDisplay(observation: OutputObservation): string {
  if (observation.value.kind === 'number') {
    const shown = observation.value.display;
    // Keep the report's own formatting ("12.5%", "1억"); bare digits from a spreadsheet cell get separators.
    return shown && !/^-?\d+(\.\d+)?$/.test(shown.trim()) ? shown : displayNumber(observation.value.value);
  }
  if (observation.value.kind === 'text') return observation.value.value;
  if (observation.value.kind === 'table') {
    return `${observation.value.rows.length}행 표 (${observation.value.columns.join(', ')})`;
  }
  return JSON.stringify(observation.value);
}

export function formatMappingLabel(candidate: { expr: TransformExpr }): string {
  return describeMapping(candidate.expr);
}

export function progressLabel(status: DiscoverySessionState['status']): string {
  switch (status) {
    case 'collecting_examples':
      return '예시를 모으는 중';
    case 'observing_output':
      return '결과물에서 항목을 찾는 중';
    case 'inventory_sources':
    case 'exploring_sources':
      return '연결된 자료를 찾아보는 중';
    case 'synthesizing':
    case 'validating':
      return '예시와 같은 결과가 나오는지 확인하는 중';
    case 'needs_attention':
      return '다시 확인이 필요해요';
    case 'needs_clarification':
      return '확인이 필요함';
    case 'ready_to_publish':
      return '맡길 수 있음';
    case 'published':
      return '업무로 저장됨';
    case 'cancelled':
      return '취소됨';
    case 'failed':
      return '실패';
    default:
      return status;
  }
}
