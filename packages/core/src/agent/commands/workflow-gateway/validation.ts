import {
  validateWorkflowContracts,
  type ContractValidationIssue,
} from '../../../workflow/contract-validator.js';
import {
  validateWorkflowIR,
  type WorkflowIR,
} from '../../../workflow/schema.js';
import type { WorkflowStore } from '../../../store/workflow-store.js';
import type {
  AxCommand,
  AxCommandIssue,
  AxCommandResult,
  AxInputRequest,
} from '../schema.js';
import type { AxWorkflowCommandResult } from './contract.js';

export function textArg(command: AxCommand, name: string): string | undefined {
  const value = command.args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function issue(code: string, message: string, path?: string, inputRequests?: AxInputRequest[]): AxCommandIssue {
  return {
    code,
    message,
    ...(path ? { path } : {}),
    ...(inputRequests?.length ? { inputRequests } : {}),
  };
}

export function requiredTextInput(id: string, label: string, reason: string): AxInputRequest {
  return { id: `ax-input-${id}`, label, type: 'text', required: true, reason };
}

export function statusForValidation(issues: ContractValidationIssue[]): AxCommandResult['status'] {
  if (issues.length === 0) return 'ok';
  return issues.every((entry) => entry.code === 'missing_input_contract' || entry.code === 'connector_unavailable')
    ? 'needs_input'
    : 'invalid';
}

export function mapContractIssue(entry: ContractValidationIssue): AxCommandIssue {
  return {
    code: entry.code,
    ...(entry.stepId ? { path: `steps.${entry.stepId}` } : {}),
    message: entry.message,
    ...(entry.expected ? { expected: entry.expected } : {}),
    ...(entry.available ? { available: entry.available } : {}),
    ...(entry.missingInputs?.length
      ? {
          inputRequests: entry.missingInputs.map((input, index) => ({
            id: `ax-input-${entry.stepId ?? entry.code}-${input.name}-${index}`,
            label: input.label,
            type: input.inputType ?? 'text',
            required: true,
            ...(input.placeholder ? { placeholder: input.placeholder } : {}),
            reason: input.question,
          })),
        }
      : {}),
  };
}

export function validateIR(store: WorkflowStore, workflow: WorkflowIR) {
  const schema = validateWorkflowIR(workflow);
  if (!schema.ok) {
    const issues = [issue('invalid_workflow_schema', schema.error)];
    return { status: 'invalid' as const, data: { valid: false, issues }, issues };
  }
  const connectedConnectors = store
    .getConnections()
    .filter((entry) => entry.connected)
    .map((entry) => entry.connector);
  const contractIssues = validateWorkflowContracts(schema.value, { connectedConnectors });
  const issues = contractIssues.map(mapContractIssue);
  return { status: statusForValidation(contractIssues), data: { valid: contractIssues.length === 0, issues }, issues };
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export type WorkflowGatewayResult = AxWorkflowCommandResult;
