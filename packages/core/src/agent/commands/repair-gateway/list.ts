import type { WorkflowStore } from '../../../store/workflow-store.js';
import {
  AxRepairListArgsSchema,
  type AxCommand,
} from '../schema.js';
import { issue, summarizeRepairProposal } from './shared.js';
import type { RepairCommandResult } from './contracts.js';

export function listRepairProposals(store: WorkflowStore, command: AxCommand): RepairCommandResult {
  const parsed = AxRepairListArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  return ['ok', {
    proposals: store.listRepairProposals({ workflowId: parsed.data.workflowId, status: parsed.data.status }).map(summarizeRepairProposal),
  }];
}
