import { isValidCronExpression, isValidTimeZone } from '../../cron.js';
import { validateRecurrence } from '../../schedule/occurrences.js';
import type { WorkflowIR } from '../../schema.js';
import type { ContractValidationIssue } from '../types.js';

/** One structured schedule form (repeat, days, times, start date, time zone); never a cron field. */
const SCHEDULE_INPUT = {
  name: 'recurrence',
  label: '실행 일정',
  question: '언제 반복할지 골라 주세요. 아래에서 다음 실행 날짜를 미리 볼 수 있습니다.',
  target: 'trigger' as const,
  inputType: 'schedule' as const,
};

function scheduleIssue(message: string): ContractValidationIssue {
  return { code: 'invalid_workflow_schema', message, missingInputs: [SCHEDULE_INPUT] };
}

function scheduleTriggerIssues(trigger: Extract<NonNullable<WorkflowIR['trigger']>, { type: 'schedule' }>): ContractValidationIssue[] {
  if (trigger.recurrence) {
    const result = validateRecurrence(trigger.recurrence);
    return result.ok ? [] : [scheduleIssue(`실행 일정을 확인해 주세요: ${result.issues.map((issue) => issue.message).join(' ')}`)];
  }
  const cron = trigger.schedule?.trim() ?? '';
  if (!cron) return [scheduleIssue('반복 업무에 실행 일정이 필요합니다.')];
  if (!isValidCronExpression(cron)) return [scheduleIssue('저장된 실행 일정을 이해하지 못했습니다. 일정을 다시 골라 주세요.')];
  // A legacy cron with a missing or unknown zone is re-chosen through the same form.
  if (!trigger.timezone.trim() || !isValidTimeZone(trigger.timezone)) {
    return [scheduleIssue('실행 일정의 시간대를 확인하지 못했습니다. 일정을 다시 골라 주세요.')];
  }
  return [];
}

export function validateTriggerConfiguration(ir: WorkflowIR): ContractValidationIssue[] {
  const trigger = ir.trigger;
  if (!trigger) return [];
  if (trigger.type === 'schedule') return scheduleTriggerIssues(trigger);

  const triggerInput = (field: string) => ({
    name: field,
    label: field,
    question: trigger.type + ' 트리거의 ' + field + ' 값을 입력해 주세요.',
    target: 'trigger' as const,
    parameterName: field,
  });

  const requiredFields: Array<[string, string | undefined]> =
    trigger.type === 'once'
      ? [['runAt', trigger.runAt]]
      : trigger.type === 'gmail.new_message'
        ? [['accountId', trigger.accountId]]
        : trigger.type === 'slack.new_message'
          ? [['channel', trigger.channel]]
          : trigger.type === 'local_folder.new_file'
            ? [['folderId', trigger.folderId]]
            : trigger.type === 'webhook.inbound'
              ? [['path', trigger.path]]
              : [];

  return requiredFields.flatMap(([field, value]) =>
    typeof value === 'string' && value.trim().length > 0
      ? []
      : [
          {
            code: 'invalid_workflow_schema' as const,
            message: trigger.type + ' 트리거에 ' + field + ' 값이 필요합니다.',
            missingInputs: [triggerInput(field)],
          },
        ],
  );
}
