import type { WorkflowStore } from '../../../store/workflow-store.js';
import type { WorkflowRuntime } from '../../engine.js';
import type { TriggerCursorStore } from '../../../triggers/types.js';

export interface TriggerPollerOptions {
  store: WorkflowStore;
  runtime: WorkflowRuntime;
  getLifecycleGeneration: () => number;
  isCurrentGeneration: (generation: number) => boolean;
  pushTransportActive: (triggerType: string) => boolean;
  rememberEvent: (key: string) => boolean;
  onTriggeredRun?: (workflowId: string, result: unknown) => void;
}

export interface TriggerPollState {
  cursors: TriggerCursorStore;
  cursorsChanged: boolean;
}
