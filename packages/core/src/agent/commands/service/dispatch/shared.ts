import type { ListSlackChannels } from '../../job-registration/contract.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';

export function slackChannelLister(
  state: AxCommandServiceState,
  options: AxCommandExecuteOptions,
): ListSlackChannels {
  return async () => {
    const readContext = options.designToolContext ?? options.designToolContextFactory?.();
    if (!readContext) return { ok: false, error: 'selection_lookup_unavailable' };
    return state.readGateway.execute(
      { tool: 'capabilities.invoke', args: { id: 'slack.channels.list', params: {} } },
      readContext,
    );
  };
}
