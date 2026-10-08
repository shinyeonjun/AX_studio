import type { ContractTypeName } from '../../../../../contracts/capability-io.js';
import type { ConnectorCapability } from '../../../../../catalog/capability-types.js';
import type { PortBinding } from '../../../../../workflow/port-binding.js';
import type { JevReadOperationHint } from '../../../../decision/read-operation-catalog.js';

export interface JevWorkflowOutputHint {
  from: string;
  output: string;
  type: ContractTypeName;
  capabilityId: string;
}

export interface ActionPlanCandidate {
  kind: 'action';
  key: string;
  capability: ConnectorCapability;
  params: Record<string, unknown>;
  bindings: Record<string, PortBinding>;
  ambiguousInputs: Array<{ port: string; choices: JevWorkflowOutputHint[] }>;
  readOperationHint?: JevReadOperationHint;
}

export interface AiPlanCandidate {
  kind: 'ai_decision';
  key: string;
  source?: JevWorkflowOutputHint;
}

export type PlanCandidate = ActionPlanCandidate | AiPlanCandidate;
