import type { AxCommand, AxCommandResult } from '../../schema.js';
import { result } from '../../contract.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';

export function executeDiscoveryCommand(
  state: AxCommandServiceState,
  command: AxCommand,
  options: Pick<AxCommandExecuteOptions, 'workspaceSessionId'> = {},
): AxCommandResult {
  const context = { workspaceSessionId: options.workspaceSessionId };
  switch (command.name) {
    case 'discovery.start':
      return result(command.name, ...state.discoveryGateway.start(command, context));
    case 'discovery.inspect':
      return result(command.name, ...state.discoveryGateway.inspect(command, context));
    case 'discovery.cancel':
      return result(command.name, ...state.discoveryGateway.cancel(command, context));
    case 'discovery.retry':
      return result(command.name, ...state.discoveryGateway.retry(command, context));
    case 'discovery.answer':
      return result(command.name, ...state.discoveryGateway.answer(command, context));
    case 'discovery.publish':
      return result(command.name, ...state.discoveryGateway.publish(command, context));
    default:
      throw new Error('Unsupported discovery command: ' + command.name);
  }
}
