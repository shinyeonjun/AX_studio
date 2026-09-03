import {
  AxCapabilityInvokeArgsSchema,
  AxSourceFileReadArgsSchema,
  AxSourceFilesListArgsSchema,
  AxSourceListArgsSchema,
  AxSourceSearchArgsSchema,
} from '../../schema.js';
import type { AxCommand, AxCommandResult } from '../../schema.js';
import { result } from '../../contract.js';
import { HOST_COMMAND_CONTEXT } from '../../access.js';
import { executeReadTool, listSessionSources, readSessionSource } from '../reads.js';
import { describeCapability, listCapabilities, listHttpConnections, listResources } from '../resources.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';
import { listCommands } from '../catalog.js';

export async function executeReadCommand(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): Promise<AxCommandResult> {
  switch (command.name) {
    case 'command.list':
      return result(command.name, 'ok', {
        commands: listCommands(options.executionContext ?? HOST_COMMAND_CONTEXT),
      });
    case 'resource.list':
      return result(command.name, 'ok', listResources(state));
    case 'http.list':
      return result(command.name, 'ok', listHttpConnections(state));
    case 'source.list':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'sources.list',
        AxSourceListArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
      ));
    case 'source.files.list':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'sources.files.list',
        AxSourceFilesListArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
      ));
    case 'source.file.read':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'sources.file.read',
        AxSourceFileReadArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
      ));
    case 'source.search':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'sources.search',
        AxSourceSearchArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
      ));
    case 'session.source.list':
      return result(command.name, ...listSessionSources(state, command, options.workspaceSessionId));
    case 'session.source.read':
      return result(command.name, ...readSessionSource(state, command, options.workspaceSessionId));
    case 'capability.list':
      return result(command.name, 'ok', listCapabilities(state, command));
    case 'capability.describe':
      return result(command.name, ...describeCapability(state, command));
    case 'capability.invoke':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'capabilities.invoke',
        AxCapabilityInvokeArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
      ));
    default:
      throw new Error('Unsupported read command: ' + command.name);
  }
}
