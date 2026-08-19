import type { ContractTypeName } from '../contracts/capability-io.js';
import { canSatisfyInput } from '../contracts/compatibility.js';
import type { Step, WorkflowIR } from './schema.js';
import {
  validateWorkflowContracts,
  type ContractValidationIssue,
} from './contract-validator.js';

interface AdapterRule {
  needed: ContractTypeName;
  from: ContractTypeName;
  connector: string;
  action: string;
  params?: Record<string, unknown>;
}

const ADAPTER_RULES: AdapterRule[] = [
  {
    needed: 'TextArtifact',
    from: 'TableArtifact',
    connector: 'transform',
    action: 'table_to_text',
  },
  {
    needed: 'TextArtifact',
    from: 'DocumentArtifact',
    connector: 'transform',
    action: 'document_to_text',
  },
  {
    needed: 'TextArtifact',
    from: 'EmailMessageRef',
    connector: 'gmail',
    action: 'messages.read',
    params: { messageId: '{{messageId}}' },
  },
];

function findAdapterRule(
  available: ContractTypeName[],
  needed: ContractTypeName,
): AdapterRule | undefined {
  if (canSatisfyInput(available, needed)) return undefined;
  return ADAPTER_RULES.find(
    (rule) => rule.needed === needed && canSatisfyInput(available, rule.from),
  );
}

function adapterStepId(targetStepId: string, rule: AdapterRule): string {
  return `adapter_${rule.connector}_${rule.action.replace('.', '_')}_before_${targetStepId}`;
}

function createAdapterStep(targetStepId: string, rule: AdapterRule): Step {
  return {
    type: 'action',
    id: adapterStepId(targetStepId, rule),
    connector: rule.connector,
    action: rule.action,
    params: rule.params ?? {},
    sideEffect: 'NONE',
  };
}

function insertAdapterBeforeStep(steps: Step[], targetStepId: string, adapter: Step): Step[] {
  const index = steps.findIndex((step) => step.id === targetStepId);
  if (index < 0) return steps;
  if (steps.some((step) => step.id === adapter.id)) return steps;
  return [...steps.slice(0, index), adapter, ...steps.slice(index)];
}

export function insertContractAdapters(ir: WorkflowIR): WorkflowIR {
  let steps = [...ir.steps];
  const maxPasses = 8;

  for (let pass = 0; pass < maxPasses; pass += 1) {
    const issues = validateWorkflowContracts({ ...ir, steps });
    const issue = issues.find(
      (candidate): candidate is ContractValidationIssue =>
        candidate.code === 'missing_input_contract' && Boolean(candidate.stepId),
    );
    if (!issue?.stepId || !issue.expected?.length) break;

    const rule = findAdapterRule(issue.available ?? [], issue.expected[0]!);
    if (!rule) break;

    const adapter = createAdapterStep(issue.stepId, rule);
    const nextSteps = insertAdapterBeforeStep(steps, issue.stepId, adapter);
    if (nextSteps.length === steps.length) break;
    steps = nextSteps;
  }

  return { ...ir, steps };
}

export function applyContractCompilation(ir: WorkflowIR): WorkflowIR {
  return insertContractAdapters(ir);
}
