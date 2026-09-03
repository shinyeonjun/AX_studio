import { canSatisfyInput, contractTypesCompatible, mergeAvailableTypes } from '../../../contracts/compatibility.js';
import type { ContractTypeName } from '../../../contracts/capability-io.js';
import { actionInputTypes, actionOutputTypes } from '../../../catalog/capability-contracts.js';
import { resolveCapability } from '../../../catalog/capability-graph.js';
import type { Step, WorkflowIR } from '../../schema.js';
import {
  bindingOutputType,
  bindingsSatisfyInputs,
} from '../../bindings/contracts.js';
import { aiDecisionOutputPorts, hasConcreteParamForPort } from '../../bindings/ports.js';
import type { BindingSource, ContractValidationIssue } from '../types.js';

function actionHasConcreteInputs(
  step: Extract<Step, { type: 'action' }>,
  ir: WorkflowIR,
  guaranteedSources: Set<BindingSource>,
): boolean {
  if (bindingsSatisfyInputs(step, ir, guaranteedSources)) {
    return true;
  }

  const cap = resolveCapability(step.connector, step.action);
  for (const [inputPort] of Object.entries(cap?.io?.inputs ?? {})) {
    if (hasConcreteParamForPort(step, inputPort)) return true;
  }
  return false;
}

export function validateStepContracts(
  step: Step,
  available: ContractTypeName[],
  ir: WorkflowIR,
  guaranteedSources: Set<BindingSource>,
): { issues: ContractValidationIssue[]; nextAvailable: ContractTypeName[] } {
  if (step.type === 'ai_decision') {
    const issues: ContractValidationIssue[] = [];
    const contracts = step.inputContracts ?? {};
    for (const [port, contract] of Object.entries(contracts)) {
      const binding = step.bindings?.[port];
      if (!binding) {
        issues.push({
          code: 'missing_input_contract',
          stepId: step.id,
          message: `${step.id} AI 단계에 ${port}(${contract}) 입력 바인딩이 필요합니다.`,
          expected: [contract],
          available,
        });
        continue;
      }
      const sourceType = bindingOutputType(binding, ir);
      if (!sourceType || !contractTypesCompatible(sourceType, contract)) {
        issues.push({
          code: 'missing_input_contract',
          stepId: step.id,
          message: `${step.id}.${port} 바인딩이 ${contract} 계약과 호환되지 않습니다.`,
          expected: [contract],
          available: sourceType ? [sourceType] : available,
        });
      } else if (binding.from !== 'trigger' && !guaranteedSources.has(binding.from)) {
        issues.push({
          code: 'missing_input_contract',
          stepId: step.id,
          message: `${step.id}.${port} 바인딩 소스 ${binding.from}가 보장된 실행 경로에 없습니다.`,
          expected: [contract],
          available,
        });
      }
    }
    return {
      issues,
      nextAvailable: mergeAvailableTypes(available, aiDecisionOutputPorts(step).map((port) => port.type)),
    };
  }

  if (step.type !== 'action') {
    return { issues: [], nextAvailable: available };
  }

  const requiredInputs = actionInputTypes(step.connector, step.action);
  if (requiredInputs.length === 0) {
    return {
      issues: [],
      nextAvailable: mergeAvailableTypes(available, actionOutputTypes(step.connector, step.action)),
    };
  }

  if (bindingsSatisfyInputs(step, ir, guaranteedSources) || actionHasConcreteInputs(step, ir, guaranteedSources)) {
    return {
      issues: [],
      nextAvailable: mergeAvailableTypes(available, actionOutputTypes(step.connector, step.action)),
    };
  }

  const missing = requiredInputs.filter((input) => !canSatisfyInput(available, input));
  if (missing.length > 0) {
    return {
      issues: [
        {
          code: 'missing_input_contract',
          stepId: step.id,
          message: `${step.connector}.${step.action} 단계에 필요한 데이터 계약을 이전 단계나 트리거가 제공하지 않습니다.`,
          expected: missing,
          available,
        },
      ],
      nextAvailable: available,
    };
  }

  return {
    issues: [],
    nextAvailable: mergeAvailableTypes(available, actionOutputTypes(step.connector, step.action)),
  };
}
