import type { InterviewAgentResult } from '../agent/output-schema.js';
import { InterviewDraftSchema, type InterviewDraft } from '../draft/schema.js';
import { normalizeLocalFolderDraft } from '../draft/local-folder.js';
import { planToInterviewDraft } from '../plan/schema.js';
import type { ConnectedResourcesSnapshot } from '../resources/connected-resources.js';
import { applySlotValuesToDraft, mergePatch } from '../slots/patch.js';
import { ensureRequiredParamKeysOnDraft } from '../slots/seed.js';
import type { HydratedInterviewState } from './state.js';

function keepKnownTrigger(next: InterviewDraft, previous: InterviewDraft): InterviewDraft {
  if (next.triggerType || !previous.triggerType) return next;
  return {
    ...next,
    triggerType: previous.triggerType,
    triggerFilter: next.triggerFilter ?? previous.triggerFilter,
    schedule: next.schedule ?? previous.schedule,
    timezone: next.timezone ?? previous.timezone,
    runAt: next.runAt ?? previous.runAt,
    gmailAccount: next.gmailAccount ?? previous.gmailAccount,
    slackChannel: next.slackChannel ?? previous.slackChannel,
    localFolderId: next.localFolderId ?? previous.localFolderId,
    localFolderPath: next.localFolderPath ?? previous.localFolderPath,
    localFolderExtensions: next.localFolderExtensions ?? previous.localFolderExtensions,
  };
}

export function buildWorkflowFromSession(
  state: HydratedInterviewState,
  result: InterviewAgentResult,
  resources: ConnectedResourcesSnapshot,
): {
  workflow: InterviewDraft;
  slotValues: Record<string, unknown>;
  partialPlan: HydratedInterviewState['partialPlan'];
} {
  let slotValues = state.slotValues;
  let partialPlan = state.partialPlan;

  if (result.kind === 'patch') {
    slotValues = mergePatch(slotValues, result.patch);
  } else {
    partialPlan = result.plan;
  }

  const merged = keepKnownTrigger(
    partialPlan
      ? planToInterviewDraft(partialPlan, slotValues, state.userInstruction)
      : applySlotValuesToDraft(state.workflow, slotValues),
    state.workflow,
  );

  const workflow = ensureRequiredParamKeysOnDraft(
    InterviewDraftSchema.parse(
      normalizeLocalFolderDraft(merged, resources),
    ),
  );

  return { workflow, slotValues, partialPlan };
}
