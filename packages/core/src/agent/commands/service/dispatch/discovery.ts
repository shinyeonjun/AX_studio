import type { AxCommand, AxCommandResult } from '../../schema.js';
import { result } from '../../contract.js';
import type { AxCommandServiceState } from '../contracts.js';

export function executeDiscoveryCommand(
  state: AxCommandServiceState,
  command: AxCommand,
): AxCommandResult {
  switch (command.name) {
    case 'discovery.start':
      return result(command.name, ...state.discoveryGateway.start(command));
    case 'discovery.inspect':
      return result(command.name, ...state.discoveryGateway.inspect(command));
    case 'discovery.cancel':
      return result(command.name, ...state.discoveryGateway.cancel(command));
    case 'discovery.retry':
      return result(command.name, ...state.discoveryGateway.retry(command));
    case 'discovery.answer':
      return result(command.name, ...state.discoveryGateway.answer(command));
    case 'discovery.publish':
      return result(command.name, ...state.discoveryGateway.publish(command));
    default:
      throw new Error('Unsupported discovery command: ' + command.name);
  }
}
