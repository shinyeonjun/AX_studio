import type { InterviewDraft } from '../draft/schema.js';

export type WorkScope = 'once' | 'recurring';

const RECURRING_TRIGGER_TYPES = new Set([
  'schedule',
  'gmail.new_message',
  'slack.new_message',
  'local_folder.new_file',
]);

export function isRecurringTriggerType(triggerType?: string | null): boolean {
  return Boolean(triggerType && RECURRING_TRIGGER_TYPES.has(triggerType));
}

export function workScopeTriggerIssue(
  workScope: WorkScope | undefined,
  triggerType: string | undefined,
): string | undefined {
  if (!workScope || !triggerType) return undefined;
  if (workScope === 'recurring' && (triggerType === 'manual' || triggerType === 'once')) {
    return '다회성 업무에는 manual/once가 아니라 새 메일·새 파일·Slack 이벤트 또는 일정 trigger가 필요합니다.';
  }
  if (workScope === 'once' && isRecurringTriggerType(triggerType)) {
    return '일회성 업무에는 반복 이벤트 trigger를 사용할 수 없습니다. 지금 실행(manual) 또는 미래 한 번(once)을 선택하세요.';
  }
  return undefined;
}

export function inferWorkScope(input: {
  workScope?: WorkScope;
  workflow?: InterviewDraft;
}): WorkScope | undefined {
  if (input.workScope) return input.workScope;
  const triggerType = input.workflow?.triggerType;
  if (triggerType === 'manual' || triggerType === 'once') return 'once';
  if (isRecurringTriggerType(triggerType)) return 'recurring';
  return undefined;
}

/** Resolve scope from an explicit session value or an already-defined trigger. */
export function resolveWorkScope(input: {
  workScope?: WorkScope;
  workflow?: InterviewDraft;
}): WorkScope {
  const resolved = inferWorkScope(input);
  if (!resolved) {
    throw Object.assign(new Error('work_scope_required'), { code: 'work_scope_required' });
  }
  return resolved;
}

export function workScopeSessionHint(workScope: WorkScope): string {
  if (workScope === 'once') {
    return '- 일회성 업무입니다. triggerType=manual을 쓰세요. 사용자가 미래 시각을 말했으면 once와 runAt. 실행 시점을 묻지 마세요.';
  }
  return '- 다회성 업무입니다. 이벤트·일정·새 파일·새 메일 중 사용자가 말한 시작 조건을 triggerType으로 표현하세요. manual/once를 대신 사용하지 마세요.';
}
