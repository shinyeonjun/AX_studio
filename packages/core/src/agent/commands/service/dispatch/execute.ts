import type { AxCommand, AxCommandResult } from '../../schema.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';
import { executeContextCommand } from './context.js';
import { executeDiscoveryCommand } from './discovery.js';
import { executeJobCommand } from './jobs.js';
import { executeReadCommand } from './read.js';
import { executeRepairCommand } from './repair.js';
import { executeReportCommand } from './report.js';
import { executeWorkflowCommand } from './workflow.js';

export async function executeCommand(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): Promise<AxCommandResult> {
  switch (command.name) {
    case 'command.list':
    case 'resource.list':
    case 'http.list':
    case 'source.list':
    case 'source.files.list':
    case 'source.file.read':
    case 'source.search':
    case 'session.source.list':
    case 'session.source.read':
    case 'capability.list':
    case 'capability.describe':
    case 'capability.invoke':
      return executeReadCommand(state, command, options);
    case 'workflow.list':
    case 'workflow.inspect':
    case 'workflow.validate':
    case 'workflow.create':
    case 'workflow.update':
    case 'workflow.delete':
    case 'workflow.run':
    case 'execution.enqueue_once':
    case 'execution.explain':
      return executeWorkflowCommand(state, command, options);
    case 'repair.list':
    case 'repair.inspect':
    case 'repair.apply':
    case 'repair.reject':
      return executeRepairCommand(state, command);
    case 'job.propose':
    case 'job.commit':
      return executeJobCommand(state, command, options);
    case 'context.update':
    case 'ui.present':
      return executeContextCommand(state, command, options);
    case 'report.generate':
      return executeReportCommand(state, command, options);
    case 'discovery.start':
    case 'discovery.inspect':
    case 'discovery.cancel':
    case 'discovery.retry':
    case 'discovery.answer':
    case 'discovery.publish':
      return executeDiscoveryCommand(state, command);
  }
}
