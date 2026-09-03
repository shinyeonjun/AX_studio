import type { WorkflowStore } from '../../store/workflow-store.js';
import {
  commandAccess,
  HOST_COMMAND_CONTEXT,
  type AxCommandExecutionContext,
} from './access.js';
import {
  AxCommandSchema,
  type AxCommandDefinition,
  type AxCommandName,
  type AxCommandResult,
} from './schema.js';
import {
  COMMAND_DEFINITIONS,
  COMMAND_NAME_SET,
  issue,
  result,
} from './contract.js';
import { executeCommand } from './service/dispatch.js';
import type {
  AxCommandExecuteOptions,
  AxCommandServiceOptions,
  AxCommandServiceState,
} from './service/contracts.js';
import { listCommands as listAvailableCommands } from './service/catalog.js';
import { createCommandServiceState } from './service/state.js';

/**
 * Single domain gateway for AI-facing commands.
 *
 * This is the single domain gateway for model-facing reads and workflow
 * mutations. Connector-specific policies stay in the existing design-tool
 * handlers; this class only maps the stable AX command names to them.
 */
export class AxCommandService {
  private readonly state: AxCommandServiceState;

  constructor(store: WorkflowStore, options: AxCommandServiceOptions = {}) {
    this.state = createCommandServiceState(store, options);
  }

  /**
   * Omitted context means an untrusted host caller. Agent callers must opt in
   * explicitly so a forgotten boundary cannot gain workflow/run authority.
   */
  listCommands(
    executionContext: AxCommandExecutionContext = HOST_COMMAND_CONTEXT,
  ): readonly AxCommandDefinition[] {
    return listAvailableCommands(executionContext);
  }

  async execute(
    raw: unknown,
    options: AxCommandExecuteOptions = {},
  ): Promise<AxCommandResult> {
    const parsed = AxCommandSchema.safeParse(raw);
    if (!parsed.success) {
      return result(
        'command.list',
        'invalid',
        undefined,
        [issue('invalid_command', parsed.error.message)],
      );
    }

    const command = parsed.data;
    const executionContext = options.executionContext ?? HOST_COMMAND_CONTEXT;
    const definition = COMMAND_DEFINITIONS.find((entry) => entry.name === command.name);
    if (!definition) {
      return result(command.name, 'invalid', undefined, [issue('unknown_command', command.name)]);
    }
    const access = commandAccess(definition, executionContext);
    if (!access.allowed) {
      return result(command.name, 'forbidden', undefined, [issue('command_forbidden', access.reason)]);
    }

    return executeCommand(this.state, command, options);
  }
}

export function isAxCommandName(value: string): value is AxCommandName {
  return COMMAND_NAME_SET.has(value);
}
