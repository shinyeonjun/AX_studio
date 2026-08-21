import { InterviewDraftSchema } from '../draft/schema.js';
import { normalizeLocalFolderDraft } from '../draft/local-folder.js';
import {
  buildIRFromWorkflow,
  buildLenientIRFromWorkflow,
} from '../compile/builder.js';
import type { DesignToolContext } from '../../design-tools/types.js';
import { buildConnectedResourcesFromConnections } from '../resources/connected-resources.js';
import { mergePatch, applySlotValuesToDraft, type InterviewPatch } from '../slots/patch.js';
import { ensureRequiredParamKeysOnDraft } from '../slots/seed.js';
import { assessSessionCompleteness, finalizeCompleteness } from './completeness.js';
import { sessionStatus } from './messages.js';
import { hydrateInterviewState, type InterviewState } from './state.js';

export interface InterviewPatchOptions {
  connectedConnectors?: string[];
  designToolContext: DesignToolContext;
}

export function applyInterviewPatch(
  state: InterviewState,
  patch: InterviewPatch,
  options: InterviewPatchOptions,
): InterviewState {
  const connectedConnectors = options.connectedConnectors ?? [];
  const resources = buildConnectedResourcesFromConnections(options.designToolContext.connections);
  const hydrated = hydrateInterviewState(state);
  const slotValues = mergePatch(hydrated.slotValues, patch);
  const workflowBase = applySlotValuesToDraft(hydrated.workflow, slotValues);
  const workflow = ensureRequiredParamKeysOnDraft(
    InterviewDraftSchema.parse(
      normalizeLocalFolderDraft(workflowBase, resources),
    ),
  );

  const hasPlan = Boolean(hydrated.partialPlan) || workflow.nodes.length > 0;

  try {
    const built = buildIRFromWorkflow(workflow);
    const { completeness, deployable } = finalizeCompleteness(
      built,
      workflow,
      connectedConnectors,
      hydrated.workScope,
    );
    return {
      ...hydrated,
      workflow,
      slotValues,
      draft: built,
      completeness,
      status: sessionStatus(deployable, false, hasPlan),
      done: false,
    };
  } catch (error) {
    // A missing value can use the completeness path; invalid graph structure
    // cannot. Unknown catalog actions remain visible as a contract slot.
    if ((error as { code?: string })?.code === 'workflow_graph_invalid') {
      throw error;
    }
    const completeness = assessSessionCompleteness(
      { ...hydrated, workflow, slotValues },
      connectedConnectors,
    );
    return {
      ...hydrated,
      workflow,
      slotValues,
      completeness,
      status: sessionStatus(false, false, hasPlan),
      done: false,
    };
  }
}
