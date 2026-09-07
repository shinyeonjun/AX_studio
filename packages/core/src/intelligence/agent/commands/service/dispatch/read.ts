import {
  AxCapabilityInvokeArgsSchema,
  AxDiscoveryDescribeArgsSchema,
  AxDiscoverySearchArgsSchema,
  AxSourceFileReadArgsSchema,
  AxSourceFilesListArgsSchema,
  AxSourceListArgsSchema,
  AxSourceSearchArgsSchema,
} from '../../schema.js';
import type { AxCommand, AxCommandResult } from '../../schema.js';
import { issue, result } from '../../contract.js';
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
    case 'capability.list':
      try {
        return result(command.name, 'ok', command.name === 'http.list'
          ? listHttpConnections(state, command) : listCapabilities(state, command));
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'invalid_catalog_pagination') throw error;
        return result(command.name, 'invalid', undefined, [issue('invalid_catalog_pagination', '조회 조건 또는 페이지 범위를 확인해 주세요.')]);
      }
    case 'source.list':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'sources.list',
        AxSourceListArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
        options.abortSignal,
      ));
    case 'source.files.list':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'sources.files.list',
        AxSourceFilesListArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
        options.abortSignal,
      ));
    case 'source.file.read':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'sources.file.read',
        AxSourceFileReadArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
        options.abortSignal,
      ));
    case 'source.search':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'sources.search',
        AxSourceSearchArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
        options.abortSignal,
      ));
    case 'discovery.search':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'discovery.search',
        AxDiscoverySearchArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
        options.abortSignal,
      ));
    case 'discovery.describe':
      return result(command.name, ...await executeReadTool(
        state,
        command,
        'discovery.describe',
        AxDiscoveryDescribeArgsSchema,
        options.designToolContext,
        options.designToolContextFactory,
        options.abortSignal,
      ));
    case 'session.source.list':
      return result(command.name, ...listSessionSources(state, command, options.workspaceSessionId));
    case 'session.source.read':
      return result(command.name, ...readSessionSource(state, command, options.workspaceSessionId));
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
        options.abortSignal,
      ));
    default:
      throw new Error('Unsupported read command: ' + command.name);
  }
}
