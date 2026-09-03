import type { WorkflowStore } from '../../../store/workflow-store.js';
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
import { resolveJobTargets } from './propose/target-selection.js';
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

  const targets = await resolveJobTargets({
    store: options.store,
    input: input.value,
    listSlackChannels: options.listSlackChannels,
  });
  if (!targets.ok) return targets.response as ProposeResponse;

  return createPendingJob({
    store: options.store,
    pending: options.pending,
    input: input.value,
    targets: targets.value,
  });
}
