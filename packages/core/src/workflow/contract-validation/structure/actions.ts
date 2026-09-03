import { actionRefFor, resolveActionDefinition, validateActionParams } from '../../action-definition.js';
import { documentIngestPathSatisfied } from '../../ingest-source.js';
import type { Step } from '../../schema.js';
import type { ContractValidationIssue } from '../types.js';

function bindingForParameter(
  step: Extract<Step, { type: 'action' }>,
  parameter: string,
): boolean {
  if (step.bindings?.[parameter]) return true;
  const aliases: Record<string, string> = {
    path: 'source',
    messageId: 'message',
  };
  return Boolean(step.bindings?.[aliases[parameter] ?? '']);
}

function actionParamConfigured(
  step: Extract<Step, { type: 'action' }>,
  parameter: string,
): boolean {
  if (parameter === 'path' && documentIngestPathSatisfied(step)) return true;
  if (bindingForParameter(step, parameter)) return true;
  const value = step.params[parameter];
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

export function validateActionConfiguration(
  step: Extract<Step, { type: 'action' }>,
): ContractValidationIssue[] {
  const definition = resolveActionDefinition(step.actionRef ?? actionRefFor(step.connector, step.action));
  if (!definition) return [];

  const missing = validateActionParams(definition, step.params).filter(
    (parameter) => !actionParamConfigured(step, parameter),
  );
  if (missing.length === 0) return [];

  const missingInputs = missing.map((name) => {
    const parameter = definition.params.find((candidate) => candidate.name === name);
    return parameter
      ? {
          name: parameter.name,
          label: parameter.label,
          question: parameter.question,
          ...(parameter.inputType ? { inputType: parameter.inputType } : {}),
          ...(parameter.placeholder ? { placeholder: parameter.placeholder } : {}),
        }
      : {
          name,
          label: name,
          question: name + ' 값이 필요합니다.',
        };
  });

  return [
    {
      code: 'invalid_workflow_schema',
      stepId: step.id,
      message: definition.id + ' 단계에 필요한 값이 없습니다: ' + missing.join(', '),
      missingInputs,
    },
  ];
}
