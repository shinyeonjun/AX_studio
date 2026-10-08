/**
 * Codes the runtime refuses a run with before any step runs (stopping, workflow removed, its run
 * queue full or busy). A scheduled occurrence or trigger event refused this way is retried as if
 * it never started, without counting as a failure.
 */
export const RUN_NOT_STARTED_CODES: ReadonlySet<string> = new Set([
  'runtime_stopping', 'workflow_removed', 'workflow_run_queue_full', 'workflow_already_running',
]);
