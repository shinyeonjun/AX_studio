import type { SkillSummary } from '../types/app-state';

export function triggerLabel(trigger?: SkillSummary['trigger']): string {
  if (!trigger) return '수동 실행';
  if (trigger.type === 'schedule') return `반복 · ${trigger.schedule ?? ''}`;
  if (trigger.type === 'once') return '1회성';
  if (trigger.type === 'gmail.new_message') return 'Gmail 새 메일';
  return '수동 실행';
}

export function isOnceTrigger(trigger?: SkillSummary['trigger']): boolean {
  return trigger?.type === 'once';
}

export function isRecurringTrigger(trigger?: SkillSummary['trigger']): boolean {
  return trigger?.type === 'schedule' || trigger?.type === 'gmail.new_message';
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
