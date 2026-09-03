import { isValidCronExpression, isValidTimeZone } from '../../cron.js';
import type { WorkflowIR } from '../../schema.js';
import type { ContractValidationIssue } from '../types.js';

export function validateTriggerConfiguration(ir: WorkflowIR): ContractValidationIssue[] {
  const trigger = ir.trigger;
  if (!trigger) return [];

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
            missingInputs: [{
              name: field,
              label: field,
              question: trigger.type + ' 트리거의 ' + field + ' 값을 입력해 주세요.',
            }],
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
    });
  }
  return issues;
}
