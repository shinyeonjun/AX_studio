import type { SkillSummary } from '../types/app-state';

export function triggerLabel(trigger?: SkillSummary['trigger']): string {
  if (!trigger) return '수동 실행';
  if (trigger.type === 'schedule') return `반복 · ${trigger.schedule ?? ''}`;
  if (trigger.type === 'once') return '1회성';
  if (trigger.type === 'gmail.new_message') return 'Gmail 새 메일';
  if (trigger.type === 'slack.new_message') return 'Slack 새 메시지';
  return '수동 실행';
}

export function isOnceTrigger(trigger?: SkillSummary['trigger']): boolean {
  return trigger?.type === 'once';
}

export function isRecurringTrigger(trigger?: SkillSummary['trigger']): boolean {
  return trigger?.type === 'schedule' || trigger?.type === 'gmail.new_message' || trigger?.type === 'slack.new_message';
}

export function isEventTriggerType(triggerType?: string | null): boolean {
  return triggerType === 'gmail.new_message' || triggerType === 'slack.new_message';
}

export function shouldRunSkillAfterSave(triggerType?: string): boolean {
  if (!triggerType || triggerType === 'once') return false;
  if (isEventTriggerType(triggerType)) return false;
  return triggerType === 'schedule' || triggerType === 'manual';
}

export function executionTriggerLabel(triggerType?: string | null): string {
  if (!triggerType || triggerType === 'manual') return '수동 실행';
  if (triggerType === 'schedule') return '예약 실행';
  if (triggerType === 'once') return '1회성 실행';
  if (triggerType === 'gmail.new_message') return 'Gmail 트리거';
  if (triggerType === 'slack.new_message') return 'Slack 트리거';
  return triggerType;
}

export function executionStatusLabel(status: string): string {
  if (status === 'success') return '성공';
  if (status === 'failed') return '실패';
  if (status === 'running') return '실행 중';
  if (status === 'cancelled') return '취소됨';
  if (status === 'pending_approval') return '승인 대기';
  return status;
}

export function executionErrorLabel(errorCode?: string | null): string | undefined {
  if (!errorCode) return undefined;
  if (errorCode === 'execution_failed') return '실행 중 오류가 발생했습니다';
  if (errorCode === 'pending_approval') return '승인을 기다리는 중입니다';
  if (errorCode === 'approval_rejected') return '승인이 거절되었습니다';
  if (errorCode === 'global_off_duty') return '전역 퇴근 상태입니다';
  if (errorCode === 'skill_paused') return '업무가 중지되어 있습니다';
  return errorCode;
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
