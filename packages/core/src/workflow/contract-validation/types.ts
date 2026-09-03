import type { ContractTypeName } from '../../contracts/capability-io.js';
import type { CapabilityParamInputType } from '../../catalog/capability-types.js';

export type BindingSource = string | 'trigger';

export interface ContractValidationIssue {
  code:
    | 'missing_input_contract'
    | 'unknown_action_contract'
    | 'connector_unavailable'
    | 'invalid_workflow_reference'
    | 'invalid_workflow_schema'
    | 'invalid_control_flow';
  stepId?: string;
  message: string;
  expected?: ContractTypeName[];
  available?: ContractTypeName[];
  missingInputs?: Array<{
    name: string;
    label: string;
    question: string;
    inputType?: CapabilityParamInputType;
    placeholder?: string;
  }>;
}

export interface WorkflowContractValidationOptions {
  /** Explicit runtime implementations supplied by a test or host process. */
  runtimeConnectors?: Record<string, unknown>;
  /** Persisted connection ids available to the desktop host. */
  connectedConnectors?: string[];
}
