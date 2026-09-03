import type {
  ContractCheckResult,
  ContractFailure,
} from './types.js';

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
