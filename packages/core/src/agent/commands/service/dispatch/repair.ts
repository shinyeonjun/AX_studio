import type { AxCommand, AxCommandResult } from '../../schema.js';
import { result } from '../../contract.js';
import type { AxCommandServiceState } from '../contracts.js';

export function executeRepairCommand(
  state: AxCommandServiceState,
  command: AxCommand,
): AxCommandResult {
  switch (command.name) {
    case 'repair.list':
      return result(command.name, ...state.repairGateway.list(command));
    case 'repair.inspect':
      return result(command.name, ...state.repairGateway.inspect(command));
    case 'repair.apply':
      return result(command.name, ...state.repairGateway.apply(command));
    case 'repair.reject':
      return result(command.name, ...state.repairGateway.reject(command));
    default:
      throw new Error('Unsupported repair command: ' + command.name);
  }
}
