import type { WorkflowStore } from '../../store/workflow-store.js';
import { applyRepairProposal } from './repair-gateway/apply.js';
import { inspectRepairProposal } from './repair-gateway/inspect.js';
import { listRepairProposals } from './repair-gateway/list.js';
import { rejectRepairProposal } from './repair-gateway/reject.js';
export type {
  RepairCommandGateway,
  RepairCommandResult,
  RepairGatewayOptions,
} from './repair-gateway/contracts.js';
import type { RepairCommandGateway, RepairGatewayOptions } from './repair-gateway/contracts.js';

export function createRepairCommandGateway(
  store: WorkflowStore,
  options: RepairGatewayOptions = {},
): RepairCommandGateway {
  return {
    list: (command) => listRepairProposals(store, command),
    inspect: (command) => inspectRepairProposal(store, options, command),
    apply: (command) => applyRepairProposal(store, options, command),
    reject: (command) => rejectRepairProposal(store, command),
  };
}
