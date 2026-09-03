import type { AxCommand, AxCommandResult } from '../../schema.js';
import { result } from '../../contract.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';
import { explainExecution } from '../execution.js';
import { slackChannelLister } from './shared.js';

export async function executeWorkflowCommand(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): Promise<AxCommandResult> {
  switch (command.name) {
    case 'workflow.list':
      return result(command.name, 'ok', state.workflowGateway.list());
    case 'workflow.inspect':
      return result(command.name, ...state.workflowGateway.inspect(command));
    case 'workflow.validate':
      return result(command.name, ...state.workflowGateway.validate(command));
    case 'workflow.create':
      return result(command.name, ...state.workflowGateway.create(command));
    case 'workflow.update':
      return result(command.name, ...state.workflowGateway.update(command));
    case 'workflow.delete':
      return result(command.name, ...state.workflowGateway.delete(command));
    case 'workflow.run':
      return result(command.name, ...await state.workflowGateway.run(command));
    case 'execution.enqueue_once':
      return result(command.name, ...await state.workflowGateway.enqueueOnce(command, {
        workspaceSessionId: options.workspaceSessionId,
        listSlackChannels: slackChannelLister(state, options),
      }));
    case 'execution.explain':
      return result(command.name, ...explainExecution(state, command));
    default:
      throw new Error('Unsupported workflow command: ' + command.name);
  }
}
