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

/**
 * Writes only the given workflows' cursors over the latest stored map, so a
 * poll tick cannot overwrite a cursor advanced meanwhile by a push delivery.
 */
export function saveTriggerCursors(
  store: WorkflowStore,
  cursors: TriggerCursorStore,
  workflowIds: Iterable<string>,
): void {
  const current = loadTriggerCursors(store);
  for (const workflowId of workflowIds) {
    const cursor = cursors[workflowId];
    if (cursor) current[workflowId] = cursor;
  }
  store.setSetting(TRIGGER_CURSOR_SETTING_KEY, current);
}

export function updateTriggerCursor(
  store: WorkflowStore,
  workflowId: string,
  update: (cursor: TriggerCursor) => TriggerCursor,
): void {
  const current = loadTriggerCursors(store);
  current[workflowId] = update(current[workflowId] ?? {});
  store.setSetting(TRIGGER_CURSOR_SETTING_KEY, current);
}
