import type { OutputObservation } from './observation/schema.js';
import type { DiscoverySessionState } from './schema.js';

export const AUTO_RESUME_STATUSES: ReadonlySet<DiscoverySessionState['status']> = new Set([
  'collecting_examples',
  'observing_output',
  'inventory_sources',
  'exploring_sources',
  'synthesizing',
  'validating',
]);

export function observationDisplay(observation: OutputObservation): string {
  if (observation.value.kind === 'number') {
    return observation.value.display ?? String(observation.value.value);
  }
  if (observation.value.kind === 'text') return observation.value.value;
  return JSON.stringify(observation.value);
}

export function formatMappingLabel(candidate: { expr: { op: string; fn?: string; column?: string; name?: string } }): string {
  if (candidate.expr.op === 'aggregate') {
    return `${candidate.expr.fn?.toUpperCase() ?? 'AGG'}(${candidate.expr.column ?? 'rows'})`;
  }
  if (candidate.expr.op === 'ratio') return 'RATIO(%)';
  if (candidate.expr.op === 'column') return `COLUMN(${candidate.expr.name})`;
  return candidate.expr.op;
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
      return '만드는 방법을 재현하는 중';
    case 'needs_attention':
      return '복구 확인이 필요함';
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
