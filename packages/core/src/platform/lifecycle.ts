/** Workflow document lifecycle — not the same as a single run. */
export type WorkflowLifecycleState = 'draft' | 'saved' | 'enabled' | 'disabled';

/** One execution of a workflow IR snapshot. */
export type RunLifecycleState =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'pending_approval';

export function workflowLifecycleFromActive(active: boolean, hasPersistedRow: boolean): WorkflowLifecycleState {
  if (!hasPersistedRow) return 'draft';
  return active ? 'enabled' : 'disabled';
}

export function isTriggerArmed(state: WorkflowLifecycleState): boolean {
  return state === 'enabled';
}

export const DEFAULT_SAVED_WORKFLOW_ACTIVE = false;
