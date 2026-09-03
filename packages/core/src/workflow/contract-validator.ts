import { linearContractSteps } from './control-flow.js';
import { triggerAvailableTypes } from './bindings/contracts.js';
import type { WorkflowIR } from './schema.js';
import {
  validateActionConfiguration,
  validateWorkflowStructure,
} from './contract-validation/structure.js';
import { validateSequence } from './contract-validation/sequence.js';
import type {
  ContractValidationIssue,
  WorkflowContractValidationOptions,
} from './contract-validation/types.js';

export type {
  BindingSource,
  ContractValidationIssue,
  WorkflowContractValidationOptions,
} from './contract-validation/types.js';

export function validateWorkflowContracts(
  ir: WorkflowIR,
  options: WorkflowContractValidationOptions = {},
): ContractValidationIssue[] {
  const structuralIssues = validateWorkflowStructure(ir, options);
  // Do not enter the recursive contract walk after a graph cycle has already
  // been identified. The graph is invalid and descending it would recurse
  // forever before the caller can surface the actionable validation issue.
  if (structuralIssues.some((issue) => issue.message.startsWith('if 분기 순환이 발견되었습니다:'))) {
    return structuralIssues;
  }
  const linear = linearContractSteps(ir.steps);
  const available = triggerAvailableTypes(ir.trigger, ir.inputs ?? []);
  return [...structuralIssues, ...validateSequence(linear, available, new Set(['trigger']), ir, ir.steps).issues];
}
/** Validation required before persisting an executable workflow version. */
export function validateWorkflowForPersistence(
  ir: WorkflowIR,
  options: WorkflowContractValidationOptions = {},
): ContractValidationIssue[] {
  const issues = validateWorkflowContracts(ir, options);
  for (const step of ir.steps) {
    if (step.type === 'action') issues.push(...validateActionConfiguration(step));
  }
  return issues;
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
