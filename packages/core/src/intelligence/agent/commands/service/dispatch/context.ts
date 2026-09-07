import type { AxCommand, AxCommandResult } from '../../schema.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';
import { presentUi, updateContext } from '../context.js';
import { result } from '../../contract.js';

export function executeContextCommand(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): AxCommandResult {
  switch (command.name) {
    case 'context.update':
      return result(command.name, ...updateContext(state, command, options));
    case 'ui.present':
      return result(command.name, ...presentUi(command));
    default:
      throw new Error('Unsupported context command: ' + command.name);
  }
}
