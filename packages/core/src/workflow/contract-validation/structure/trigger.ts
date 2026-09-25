import { isValidCronExpression, isValidTimeZone } from '../../cron.js';
import type { WorkflowIR } from '../../schema.js';
import type { ContractValidationIssue } from '../types.js';

export function validateTriggerConfiguration(ir: WorkflowIR): ContractValidationIssue[] {
  const trigger = ir.trigger;
  if (!trigger) return [];

  const triggerInput = (field: string) => ({
    name: field,
    label: trigger.type === 'schedule'
      ? field === 'schedule' ? '실행 일정 (Cron)' : '시간대'
      : field,
    question: trigger.type === 'schedule'
      ? field === 'schedule'
        ? '실행 반복 시각을 cron 형식으로 입력해 주세요.'
        : '실행할 시간대를 입력해 주세요.'
      : trigger.type + ' 트리거의 ' + field + ' 값을 입력해 주세요.',
    target: 'trigger' as const,
    parameterName: field,
    ...(trigger.type === 'schedule' ? {
      inputType: 'text' as const,
      placeholder: field === 'schedule' ? '0 9 * * 1-5' : 'Asia/Seoul',
    } : {}),
  });

  const requiredFields: Array<[string, string | undefined]> =
    trigger.type === 'schedule'
      ? [
          ['schedule', trigger.schedule],
          ['timezone', trigger.timezone],
        ]
      : trigger.type === 'once'
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

  const issues: ContractValidationIssue[] = requiredFields.flatMap(([field, value]) =>
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
  if (
    trigger.type === 'schedule' &&
    trigger.schedule.trim() &&
    !isValidCronExpression(trigger.schedule)
  ) {
    issues.push({
      code: 'invalid_workflow_schema',
      message: 'schedule cron 표현식이 올바르지 않습니다: ' + trigger.schedule,
      missingInputs: [triggerInput('schedule')],
    });
  }
  if (
    trigger.type === 'schedule' &&
    trigger.timezone.trim() &&
    !isValidTimeZone(trigger.timezone)
  ) {
    issues.push({
      code: 'invalid_workflow_schema',
      message: 'schedule timezone이 올바르지 않습니다: ' + trigger.timezone,
      missingInputs: [triggerInput('timezone')],
    });
  }
  return issues;
}
