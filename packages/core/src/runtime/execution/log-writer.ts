import type { ExecutionLogEntry } from '../../connectors/types.js';
import type { WorkflowStore } from '../../persistence/workflow-store.js';

type ExecutionLogStore = Pick<WorkflowStore, 'updateExecutionLog'> & Partial<Pick<WorkflowStore, 'appendExecutionLog'>>;

/**
 * Incremental execution-log persistence. Appends only the new tail when this
 * writer knows the stored log equals everything before it; otherwise (first
 * write, or entries pushed onto `log` by other code since the last write) it
 * rewrites the full log, exactly like updateExecutionLog always did.
 */
export function createExecutionLogWriter(
  store: ExecutionLogStore,
  executionId: string,
  log: ExecutionLogEntry[],
  persistedLength = -1,
): (entry: ExecutionLogEntry) => void {
  let persisted = persistedLength;
  return (entry) => {
    const before = log.length;
    log.push(entry);
    if (persisted === before && typeof store.appendExecutionLog === 'function'
      && store.appendExecutionLog(executionId, [entry])) {
      persisted = log.length;
      return;
    }
    store.updateExecutionLog(executionId, log);
    persisted = log.length;
  };
}
