import type { WorkflowStore } from '../../../store/workflow-store.js';
import {
  TRIGGER_CURSOR_SETTING_KEY,
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
