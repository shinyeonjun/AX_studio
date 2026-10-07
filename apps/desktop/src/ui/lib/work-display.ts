import { CONNECTOR_CATALOG, getCapability } from '@ax-studio/core/catalog-data';
import { describeSchedule } from '@ax-studio/core/schedule';
import type { WorkSummary } from '../../types/app-state';

function connectorLabel(connector: string): string {
  return CONNECTOR_CATALOG[connector as keyof typeof CONNECTOR_CATALOG]?.label ?? connector;
}
export function triggerLabel(trigger?: WorkSummary['trigger']): string {
  if (!trigger) return '직접 실행';
  if (trigger.type === 'schedule') return `반복 · ${describeSchedule(trigger) || '일정 미정'}`;
  if (trigger.type === 'once') return '한 번 예약';
  const capability = getCapability(trigger.type);
  if (capability) {
    const label = connectorLabel(capability.connector);
    return capability.label.startsWith(label)
      ? capability.label
      : `${label} ${capability.label}`;
  }
  return '직접 실행';
}

/** 직접 실행·한 번 예약 — 한 번만 하는 업무 목록 */
export function isEphemeralWork(trigger?: WorkSummary['trigger']): boolean {
  const type = trigger?.type;
  return !type || type === 'manual' || type === 'once';
}

/** 반복·자동 시작 — 업무 목록 */
export function isPersistentWork(trigger?: WorkSummary['trigger']): boolean {
  return !isEphemeralWork(trigger);
}

export function isSingleExecution(execution: {
  ephemeral?: boolean;
  workflowId?: string | null;
}): boolean {
  // Older state payloads did not expose `ephemeral`; workflowId is the safe
  // compatibility fallback because ephemeral runs never reference a workflow.
  return execution.ephemeral ?? !execution.workflowId;
}

export function executionTriggerLabel(triggerType?: string | null): string {
  if (!triggerType || triggerType === 'manual') return '직접 실행';
  if (triggerType === 'schedule') return '예약 실행';
  if (triggerType === 'once') return '한 번 예약';
  const capability = getCapability(triggerType);
  if (capability?.kind === 'trigger') return `${connectorLabel(capability.connector)} 자동 시작`;
  return '자동 시작';
}

export function executionStatusLabel(status: string): string {
  if (status === 'success') return '성공';
  if (status === 'failed') return '실패';
  if (status === 'running') return '실행 중';
  if (status === 'cancelled') return '취소됨';
  if (status === 'pending_approval') return '승인 대기';
  return '상태 확인 필요';
}

const DOCUMENT_READER_UNAVAILABLE =
  '문서 읽기 기능이 준비되지 않았어요. 앱을 다시 시작해 보고, 계속되면 설정 > 진단 정보 내보내기로 문의해 주세요.';

/** Step ids are internal names; show a number when the id carries one, otherwise a generic label. */
/** A step as people count it ("2단계"); a step without a known place is just the current one. */
export function executionStepLabel(stepNumber?: number): string {
  return stepNumber && stepNumber > 0 ? `${stepNumber}단계` : '진행 중인 단계';
}

export function executionErrorLabel(errorCode?: string | null): string | undefined {
  if (!errorCode) return undefined;
  if (errorCode === 'execution_failed') return '실행 중 오류가 발생했습니다';
  if (errorCode === 'pending_approval') return '승인을 기다리는 중입니다';
  if (errorCode === 'approval_rejected') return '승인이 거절되었습니다';
  if (errorCode === 'global_off_duty') return '모든 자동 실행이 잠시 꺼져 있어요(퇴근 모드)';
  if (errorCode === 'action_failed') return '작업 실행에 실패했습니다';
  if (errorCode === 'path_required') return '문서 경로가 비어 있습니다';
  if (errorCode === 'manual_run_input_missing') return '실행할 파일을 찾지 못했습니다';
  if (errorCode === 'document_ingest_failed') return '문서 읽기에 실패했습니다';
  if (errorCode === 'document_engine_empty_response' || errorCode === 'document_engine_dependency_missing') {
    return DOCUMENT_READER_UNAVAILABLE;
  }
  if (errorCode === 'slack_error') return 'Slack 전송에 실패했습니다';
  if (errorCode === 'agent_invoke_failed') return 'AI 판단 단계 호출에 실패했습니다';
  if (errorCode === 'agent_timeout') return 'AI 판단 단계가 시간 초과되었습니다';
  if (errorCode === 'workflow_paused') return '업무가 중지되어 있습니다';
  if (errorCode === 'output_contract_failed') return '실행은 끝났지만 결과가 기준에 맞지 않아 멈췄어요. 결과를 확인해 주세요';
  if (errorCode === 'input_schema_drift') return '읽어 온 자료의 열 구성이 예전과 달라졌어요. 자료를 확인해 주세요';
  if (errorCode === 'workflow_already_running') return '같은 업무가 이미 실행 중이라 이번 실행은 건너뛰었습니다';
  if (errorCode === 'workflow_run_queue_full') return '대기 중인 실행이 너무 많아 이번 실행은 건너뛰었습니다';
  if (errorCode === 'approval_expired') return '승인 대기 시간이 지나 실행이 취소되었습니다. 아무 작업도 실행되지 않았습니다';
  if (errorCode === 'template_non_primitive') {
    return '단계 입력에 목록·객체 값이 들어가 문장으로 바꿀 수 없습니다. 업무 단계의 입력값을 확인해 주세요';
  }
  if (errorCode === 'condition_ref_missing') return '조건 분기가 참조하는 이전 단계 결과를 찾지 못했습니다';
  if (errorCode === 'step_timeout') {
    return '단계 실행 시간이 초과되었습니다. 외부 서비스에 이미 반영됐을 수 있으니 결과를 확인해 주세요';
  }
  if (errorCode === 'execution_paused') return '업무가 꺼져 있어 이번 예약은 건너뛰었어요';
  if (errorCode === 'schedule_changed') return '일정이 바뀌어 이번 예약은 건너뛰었어요';
  if (errorCode === 'max_lateness_exceeded') return '앱이 꺼져 있던 동안 예약 시간이 지나 건너뛰었어요';
  if (errorCode === 'approval_pending') return '이전 실행이 승인을 기다리고 있어 건너뛰었어요';
  if (errorCode === 'execution_error') return '실행 중 오류가 발생했습니다';
  if (errorCode === 'max_attempts_exceeded') return '여러 번 다시 시도했지만 실행하지 못했어요';
  if (errorCode === 'external_effect_possible') {
    return '외부에 이미 보냈을 수 있어 다시 시도하지 않았어요. 결과를 확인해 주세요';
  }
  return '실행 중 문제가 생겼어요';
}

export function formatRelativeTime(iso?: string): string {
  if (!iso) return '실행 기록 없음';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '방금 전';
  if (mins < 60) return `${mins}분 전`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}
