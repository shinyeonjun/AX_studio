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
    ? '자료의 열 구성이 예전과 달라 실행을 멈췄습니다. 자료를 확인해 주세요.'
    : '실행 결과가 예전 기준과 달라 밖으로 보내지 않았습니다. 결과를 확인해 주세요.';
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
