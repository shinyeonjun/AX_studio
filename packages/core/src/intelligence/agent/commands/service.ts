import type { WorkflowStore } from '../../../persistence/workflow-store.js';
import type { DecisionEngine } from '../../../contracts/decision.js';
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
import { executeCommand } from './service/dispatch/execute.js';
import type {
  AxCommandExecuteOptions,
  AxCommandServiceOptions,
  AxCommandServiceState,
} from './service/contracts.js';
import { listCommands as listAvailableCommands } from './service/catalog.js';
import { createCommandServiceState } from './service/state.js';
import {
  assertMetadataDispatchPermit, claimMetadataDispatchPermit, RequestUnderstandingInvalidatedError,
} from '../../decision/request-understanding/session.js';
import { describeRegisteredHttpMetadata } from './service/registered-http-metadata.js';
export { snapshotRegisteredHttpMetadata } from './service/registered-http-metadata.js';

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

  setDecisionEngine(decisionEngine?: DecisionEngine): void {
    this.state.discoveryGateway.setDecisionEngine(decisionEngine);
  }

  releaseWorkspaceSession(sessionId: string): void {
    this.state.pendingJobs.delete(sessionId.trim());
    this.state.pendingMutations.delete(sessionId.trim());
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
    options.abortSignal?.throwIfAborted();
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

    let metadataClaim;
    if (options.metadataDispatchPermit) {
      try {
        metadataClaim = claimMetadataDispatchPermit(options.metadataDispatchPermit, command);
      } catch (error) {
        if (error instanceof RequestUnderstandingInvalidatedError) throw error;
        return result(command.name, 'forbidden', undefined, [issue('metadata_scope_forbidden', '등록된 소스와 현재 요청에 고정된 메타데이터 작업만 허용됩니다.')]);
      }
    }
    const executed = metadataClaim?.adapter
      ? describeRegisteredHttpMetadata(this.state.store, command, metadataClaim)
      : await executeCommand(this.state, command, options);
    if (options.metadataDispatchPermit) assertMetadataDispatchPermit(options.metadataDispatchPermit, command);
    return executed;
  }
}

export function isAxCommandName(value: string): value is AxCommandName {
  return COMMAND_NAME_SET.has(value);
}
