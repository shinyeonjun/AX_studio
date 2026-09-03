import { actionRefFor, resolveActionDefinition } from '../../action-definition.js';
import { isConnectorAlwaysOn, resolveCapability } from '../../../catalog/capability-graph.js';
import { getConnectorCatalogEntry } from '../../../catalog/connectors.js';
import { resolveEffectiveSideEffect } from '../../side-effect-resolve.js';
import type { Step } from '../../schema.js';
import type { ContractValidationIssue, WorkflowContractValidationOptions } from '../types.js';

export function validateActionContract(
  step: Extract<Step, { type: 'action' }>,
  options: WorkflowContractValidationOptions,
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [];
  const capability = resolveCapability(step.connector, step.action);
  if (!capability) {
    issues.push({
      code: 'unknown_action_contract',
      stepId: step.id,
      message: '지원하지 않는 action입니다: ' + step.connector + '.' + step.action,
    });
  } else if (
    options.runtimeConnectors !== undefined &&
    getConnectorCatalogEntry(step.connector)?.runtimeAvailable !== true &&
    !options.runtimeConnectors[step.connector]
  ) {
    issues.push({
      code: 'connector_unavailable',
      stepId: step.id,
      message: step.connector + '는 현재 실행 구현이 없어 이 workflow에서 사용할 수 없습니다.',
    });
  } else if (
    options.connectedConnectors &&
    !isConnectorAlwaysOn(step.connector) &&
    !options.connectedConnectors.includes(step.connector)
  ) {
    issues.push({
      code: 'connector_unavailable',
      stepId: step.id,
      message: step.connector + ' 연결이 없어 이 workflow를 저장할 수 없습니다.',
    });
  }

  const definition = resolveActionDefinition(step.actionRef ?? actionRefFor(step.connector, step.action));
  if (!definition) return issues;

  if (step.connector !== definition.connector || step.action !== definition.action) {
    issues.push({
      code: 'invalid_workflow_schema',
      stepId: step.id,
      message: step.id + ' actionRef와 connector/action이 일치하지 않습니다: ' + definition.id,
    });
  }
  const expectedSideEffect = resolveEffectiveSideEffect(definition, step.params ?? {});
  if (step.sideEffect !== expectedSideEffect) {
    issues.push({
      code: 'invalid_workflow_schema',
      stepId: step.id,
      message: step.id + ' sideEffect가 catalog와 다릅니다. ' + expectedSideEffect + '를 사용해야 합니다.',
    });
  }
  return issues;
}
