import { canSatisfyInput, mergeAvailableTypes } from '../contracts/compatibility.js';
import type { ContractTypeName } from '../contracts/capability-io.js';
import {
  actionInputTypes,
  actionOutputTypes,
} from '../catalog/capability-contracts.js';
import { resolveCapability } from '../catalog/capability-graph.js';
import { skipInLinearScan, stepsById } from '../runtime/control-flow.js';
import type { Step, WorkflowIR } from './schema.js';
import { bindingsSatisfyInputs, triggerAvailableTypes } from './bindings.js';

export type BindingSource = string | 'trigger';

export interface ContractValidationIssue {
  code: 'missing_input_contract' | 'unknown_action_contract';
  stepId?: string;
  message: string;
  expected?: ContractTypeName[];
  available?: ContractTypeName[];
}

function isConcreteParamValue(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0 && !value.includes('{{');
}

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
    if (inputPort === 'source') {
      if (isConcreteParamValue(step.params?.path) || step.params?.file) return true;
      continue;
    }
    if (isConcreteParamValue(step.params?.[inputPort])) return true;
  }
  return false;
}

function stepContractIssues(
  step: Step,
  available: ContractTypeName[],
  ir: WorkflowIR,
  guaranteedSources: Set<BindingSource>,
): { issues: ContractValidationIssue[]; nextAvailable: ContractTypeName[] } {
  if (step.type === 'ai_decision') {
    return {
      issues: [],
      nextAvailable: mergeAvailableTypes(available, ['JsonArtifact', 'TextArtifact']),
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

function addedTypes(base: ContractTypeName[], end: ContractTypeName[]): ContractTypeName[] {
  return end.filter((type) => !base.includes(type));
}

/** After IF, only types produced on every branch remain guaranteed. */
function mergeBranchAvailability(
  base: ContractTypeName[],
  thenAvailable: ContractTypeName[],
  elseAvailable: ContractTypeName[],
): ContractTypeName[] {
  const thenAdded = addedTypes(base, thenAvailable);
  const elseAdded = addedTypes(base, elseAvailable);
  const shared = thenAdded.filter((type) => elseAdded.includes(type));
  return mergeAvailableTypes(base, shared);
}

function mergeGuaranteedSources(
  base: Set<BindingSource>,
  thenSources: Set<BindingSource>,
  elseSources: Set<BindingSource>,
): Set<BindingSource> {
  const sharedBranchSteps = [...thenSources].filter(
    (source) => source !== 'trigger' && elseSources.has(source),
  );
  return new Set([...base, ...sharedBranchSteps]);
}

function validateSequence(
  sequence: Step[],
  available: ContractTypeName[],
  guaranteedSources: Set<BindingSource>,
  ir: WorkflowIR,
  allSteps: Step[],
): { issues: ContractValidationIssue[]; available: ContractTypeName[]; guaranteedSources: Set<BindingSource> } {
  let current = available;
  let currentGuaranteed = new Set(guaranteedSources);
  const issues: ContractValidationIssue[] = [];

  for (const step of sequence) {
    if (step.type === 'if') {
      const guard = stepContractIssues(step, current, ir, currentGuaranteed);
      issues.push(...guard.issues);

      const thenResult = validateSequence(
        stepsById(allSteps, step.thenStepIds),
        current,
        currentGuaranteed,
        ir,
        allSteps,
      );
      const elseResult = validateSequence(
        stepsById(allSteps, step.elseStepIds ?? []),
        current,
        currentGuaranteed,
        ir,
        allSteps,
      );
      issues.push(...thenResult.issues, ...elseResult.issues);
      current = mergeBranchAvailability(current, thenResult.available, elseResult.available);
      currentGuaranteed = mergeGuaranteedSources(
        currentGuaranteed,
        thenResult.guaranteedSources,
        elseResult.guaranteedSources,
      );
      continue;
    }

    const result = stepContractIssues(step, current, ir, currentGuaranteed);
    issues.push(...result.issues);
    current = result.nextAvailable;
    currentGuaranteed.add(step.id);
  }

  return { issues, available: current, guaranteedSources: currentGuaranteed };
}

export function validateWorkflowContracts(ir: WorkflowIR): ContractValidationIssue[] {
  const skip = skipInLinearScan(ir.steps);
  const linear = ir.steps.filter((step) => !skip.has(step.id));
  const available = triggerAvailableTypes(ir.trigger, ir.inputs ?? []);
  return validateSequence(linear, available, new Set(['trigger']), ir, ir.steps).issues;
}

export function validateWorkflowContractsOrThrow(ir: WorkflowIR): void {
  const issues = validateWorkflowContracts(ir);
  if (issues.length === 0) return;
  const first = issues[0]!;
  const error = new Error(first.message) as Error & { code: string; issues: ContractValidationIssue[] };
  error.code = 'contract_validation_failed';
  error.issues = issues;
  throw error;
}
