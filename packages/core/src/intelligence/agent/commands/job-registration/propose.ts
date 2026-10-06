import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import type {
  AxCommandIssue,
  AxCommandResult,
} from '../schema.js';
import type {
  ListSlackChannels,
  PendingJobDraft,
} from './contract.js';
import { createPendingJob } from './propose/draft.js';
import { validateProposeInput } from './propose/input.js';
import { cachedSlackChannelLister, resolveGenericJobTargets, resolveJobTargets } from './propose/target-selection.js';
import { slackChannelLabels } from './targets.js';
import type { ProposeResponse } from './propose/contracts.js';

export async function proposeJob(options: {
  store: WorkflowStore;
  pending: Map<string, PendingJobDraft>;
  workspaceSessionId?: string;
  args: unknown;
  listSlackChannels?: ListSlackChannels;
}): Promise<[AxCommandResult['status'], unknown, AxCommandIssue[]?]> {
  const input = validateProposeInput(options.args, options.workspaceSessionId);
  if (!input.ok) return input.response as ProposeResponse;
  // One listing serves target checks and the channel names on the confirmation card.
  const listSlackChannels = cachedSlackChannelLister(options.listSlackChannels);

  if (input.value.genericWorkflow) {
    const targets = await resolveGenericJobTargets({
      store: options.store,
      input: input.value,
      listSlackChannels,
    });
    if (!targets.ok) return targets.response as ProposeResponse;
    return createPendingJob({
      store: options.store,
      pending: options.pending,
      input: targets.input,
      channelLabels: await channelLabelsFor(targets.input.data, listSlackChannels),
    });
  }

  const targets = await resolveJobTargets({
    store: options.store,
    input: input.value,
    listSlackChannels,
  });
  if (!targets.ok) return targets.response as ProposeResponse;

  return createPendingJob({
    store: options.store,
    pending: options.pending,
    input: input.value,
    targets: targets.value,
    channelLabels: await channelLabelsFor({ channel: targets.value.channel }, listSlackChannels),
  });
}

const SLACK_CHANNEL_ID = /^[CGD][A-Z0-9]{6,}$/u;

/** Names for the Slack channel ids the draft uses; looked up only when an id would otherwise be shown. */
async function channelLabelsFor(
  draft: unknown,
  listSlackChannels: ListSlackChannels | undefined,
): Promise<Record<string, string>> {
  if (!listSlackChannels || !mentionsChannelId(draft)) return {};
  try {
    const result = await listSlackChannels();
    return result.ok ? slackChannelLabels(result.data) : {};
  } catch {
    return {};
  }
}

function mentionsChannelId(value: unknown, depth = 0): boolean {
  if (depth > 6 || !value || typeof value !== 'object') return false;
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'channel' && typeof entry === 'string' && SLACK_CHANNEL_ID.test(entry.trim())) return true;
    if (entry && typeof entry === 'object' && mentionsChannelId(entry, depth + 1)) return true;
  }
  return false;
}
