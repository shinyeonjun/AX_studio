import { commitJob, proposeJob } from '../../job-registration/service.js';
import type { AxCommand, AxCommandResult } from '../../schema.js';
import { result } from '../../contract.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';
import { slackChannelLister } from './shared.js';

export async function executeJobCommand(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): Promise<AxCommandResult> {
  switch (command.name) {
    case 'job.propose':
      return result(command.name, ...await proposeJob({
        store: state.store,
        pending: state.pendingJobs,
        workspaceSessionId: options.workspaceSessionId,
        args: command.args,
        listSlackChannels: slackChannelLister(state, options),
      }));
    case 'job.commit':
      return result(command.name, ...await commitJob({
        store: state.store,
        pending: state.pendingJobs,
        workspaceSessionId: options.workspaceSessionId,
        allowJobCommit: options.allowJobCommit,
        runWorkflow: state.options.runWorkflow,
      }));
    default:
      throw new Error('Unsupported job command: ' + command.name);
  }
}
