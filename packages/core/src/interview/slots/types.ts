import type { ContractValidationIssue } from '../../workflow/contract-validator.js';

export type RequirementSlot = string;

export interface SlotState {
  slot: RequirementSlot;
  filled: boolean;
  label?: string;
  question?: string;
}

export interface CompletenessResult {
  slots: SlotState[];
  missingRequired: RequirementSlot[];
  deployable: boolean;
  missingConnections: string[];
  contractIssues?: ContractValidationIssue[];
}
