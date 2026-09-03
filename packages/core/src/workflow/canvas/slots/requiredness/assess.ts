import { isConnectorAlwaysOn } from '../../../../catalog/capability-graph.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { validateWorkflowContracts, type ContractValidationIssue } from '../../../../workflow/contract-validator.js';
import { parseWorkflowIR } from '../../../../workflow/schema.js';
import type { CompletenessResult } from '../types.js';
import { computeRequiredSlots } from './compute.js';

export function assessCompleteness(
  ir: Partial<WorkflowIR>,
  connectedConnectors: string[] = [],
): CompletenessResult {
  const slots = computeRequiredSlots(ir);
  const missingRequired = slots.filter((slot) => !slot.filled).map((slot) => slot.slot);
  const neededConnectors = new Set<string>();
  for (const step of ir.steps ?? []) {
    if (step.type === 'action' && !isConnectorAlwaysOn(step.connector)) neededConnectors.add(step.connector);
  }
  if (ir.trigger?.type === 'gmail.new_message') neededConnectors.add('gmail');
  if (ir.trigger?.type === 'slack.new_message') neededConnectors.add('slack');
  if (ir.trigger?.type === 'local_folder.new_file') neededConnectors.add('local_folder');
  const missingConnections = [...neededConnectors].filter((connector) => !connectedConnectors.includes(connector));
  let contractIssues: ContractValidationIssue[] = [];
  if ((ir.steps?.length ?? 0) > 0 && ir.trigger && missingRequired.length === 0) {
    try {
      contractIssues = validateWorkflowContracts(parseWorkflowIR(ir));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      contractIssues = [{ code: 'invalid_workflow_schema', message: `workflow 데이터 계약을 해석할 수 없습니다${detail ? `: ${detail}` : '.'}` }];
    }
  }
  for (const contractIssue of contractIssues) {
    slots.push({ slot: contractIssue.stepId ? `contract.${contractIssue.stepId}` : 'contract.workflow', filled: false, label: '데이터 연결', question: contractIssue.message });
  }
  const deployable = missingRequired.length === 0 && missingConnections.length === 0 && contractIssues.length === 0 && (ir.steps?.length ?? 0) > 0;
  return { slots, missingRequired, deployable, missingConnections, contractIssues };
}
