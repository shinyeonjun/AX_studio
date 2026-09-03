import type { WorkflowStore } from '../../store/workflow-store.js';
import {
  type AxEnqueueOnceOptions,
  type AxWorkflowCommandGateway,
  type AxWorkflowCommandResult,
  type WorkflowGatewayOptions,
} from './workflow-gateway/contract.js';
import { enqueueOnce as enqueueOnceCommand } from './workflow-gateway/enqueue.js';
import {
  createWorkflow,
  deleteWorkflow,
  updateWorkflow,
} from './workflow-gateway/mutations.js';
import {
  inspectWorkflow,
  runWorkflow,
  validateWorkflow,
} from './workflow-gateway/read.js';

export type {
  AxEnqueueOnceOptions,
  AxWorkflowCommandGateway,
  AxWorkflowCommandResult,
} from './workflow-gateway/contract.js';

export function createWorkflowCommandGateway(
  store: WorkflowStore,
  options: WorkflowGatewayOptions = {},
): AxWorkflowCommandGateway {
  return {
    list: () => ({ workflows: store.listWorkflows() }),
    inspect: (command) => inspectWorkflow(store, command),
    validate: (command) => validateWorkflow(store, command),
    create: (command) => createWorkflow(store, command),
    update: (command) => updateWorkflow(store, command),
    delete: (command) => deleteWorkflow(store, command),
    run: (command): Promise<AxWorkflowCommandResult> => runWorkflow(store, options.runWorkflow, command),
    enqueueOnce: (command, enqueueOptions) => enqueueOnceCommand(
      store,
      options.enqueueOnce,
      command,
      enqueueOptions,
    ),
  };
}
