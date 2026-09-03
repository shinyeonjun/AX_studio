import { parseWorkflowIR } from '../../../workflow/schema.js';
import { AxExecutionExplainArgsSchema } from '../schema.js';
import type {
  AxCommand,
  AxCommandIssue,
  AxCommandResult,
} from '../schema.js';
import {
  issue,
  qualityIssuesFromLog,
} from '../contract.js';
import type { AxCommandServiceState } from './contracts.js';

type CommandResultTuple = [
  AxCommandResult['status'],
  unknown,
  AxCommandIssue[]?,
];

export function explainExecution(
  state: AxCommandServiceState,
  command: AxCommand,
): CommandResultTuple {
  const parsed = AxExecutionExplainArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const execution = state.store.getExecution(parsed.data.executionId);
  if (!execution) {
    return ['not_found', undefined, [issue('execution_not_found', '실행을 찾을 수 없습니다.', 'args.executionId')]];
  }

  let hasOutputContract = false;
  if (execution.irJson) {
    try {
      hasOutputContract = Boolean(parseWorkflowIR(JSON.parse(execution.irJson)).outputContract);
    } catch {
      hasOutputContract = false;
    }
  }

  const quality = qualityIssuesFromLog(execution.logJson, execution.errorCode);
  const qualityFailure = execution.errorCode === 'output_contract_failed' || execution.errorCode === 'input_schema_drift';
  const technicalStatus = execution.errorCode === 'input_schema_drift'
    ? 'blocked'
    : execution.errorCode === 'output_contract_failed'
      ? 'completed'
      : execution.status === 'success'
        ? 'completed'
        : execution.status === 'pending_approval'
          ? 'waiting_approval'
          : execution.status;
  const resultStatus = execution.errorCode === 'output_contract_failed'
    ? 'failed'
    : execution.errorCode === 'input_schema_drift'
      ? 'not_evaluated'
      : execution.status === 'success' && hasOutputContract
        ? 'passed'
        : 'not_evaluated';
  const reason = quality.issues[0]?.message ?? (
    execution.errorCode === 'input_schema_drift'
      ? '입력 자료의 열 구조가 과거 기준과 달라 결과를 평가하지 않았습니다.'
      : execution.errorCode === 'output_contract_failed'
        ? '실행은 끝났지만 결과가 과거 기준을 벗어났습니다.'
        : undefined
  );

  return ['ok', {
    executionId: execution.id,
    workflowId: execution.workflowId ?? undefined,
    workflowVersion: execution.workflowVersion ?? undefined,
    triggerType: execution.triggerType ?? undefined,
    status: execution.status,
    technicalStatus,
    resultStatus,
    hasOutputContract,
    ...(reason ? { reason } : {}),
    ...(quality.phase ? { phase: quality.phase } : {}),
    ...(qualityFailure || quality.issues.length > 0 ? { issues: quality.issues } : {}),
  }];
}
