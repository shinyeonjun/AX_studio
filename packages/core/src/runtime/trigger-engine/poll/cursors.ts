import type { WorkflowStore } from '../../../persistence/workflow-store.js';
import {
  TRIGGER_CURSOR_SETTING_KEY,
  type TriggerCursor,
  type TriggerCursorStore,
} from '../../../triggers/types.js';
import { parseTriggerCursorStore } from '../helpers.js';

export function loadTriggerCursors(store: WorkflowStore): TriggerCursorStore {
  return parseTriggerCursorStore(
    store.getSetting<unknown>(TRIGGER_CURSOR_SETTING_KEY, {}),
  );
}

export function saveTriggerCursors(
  store: WorkflowStore,
  cursors: TriggerCursorStore,
): void {
  store.setSetting(TRIGGER_CURSOR_SETTING_KEY, cursors);
}

/** Checkpoint one workflow without restoring a peer cursor deleted during an await. */
export function saveWorkflowTriggerCursor(store: WorkflowStore, workflowId: string, cursor: TriggerCursor): void {
  saveTriggerCursors(store, { ...loadTriggerCursors(store), [workflowId]: cursor });
}
