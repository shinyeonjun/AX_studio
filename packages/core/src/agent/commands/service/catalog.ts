import {
  commandAccess,
  HOST_COMMAND_CONTEXT,
  type AxCommandExecutionContext,
} from '../access.js';
import { COMMAND_DEFINITIONS } from '../contract.js';
import type { AxCommandDefinition } from '../schema.js';

export function listCommands(
  executionContext: AxCommandExecutionContext = HOST_COMMAND_CONTEXT,
): readonly AxCommandDefinition[] {
  return COMMAND_DEFINITIONS.filter((entry) => {
    if (entry.name === 'job.commit') return false;
    return commandAccess(entry, executionContext).allowed;
  });
}
