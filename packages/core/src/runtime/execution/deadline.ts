import type { ConnectorContext } from '../../connectors/types.js';
import type { WorkflowExecutionHost } from './contracts.js';

/** A hung connector or model call must not hold a run (and app quit) forever. */
export const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1_000;

/**
 * Runs one step with a deadline. The step sees an abort signal that fires on
 * timeout or when the run itself is aborted, and the run stops waiting even if
 * the step ignores that signal. A timed-out step fails with `step_timeout`;
 * its external outcome is unknown and it is never retried automatically.
 */
export async function withStepDeadline<T>(
  host: WorkflowExecutionHost,
  ctx: ConnectorContext,
  stepId: string,
  run: () => Promise<T>,
): Promise<T> {
  const configured = host.config.stepTimeoutMs;
  const timeoutMs = typeof configured === 'number' && Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_STEP_TIMEOUT_MS;
  const parent = ctx.abortSignal;
  parent?.throwIfAborted();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onParentAbort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = Object.assign(
        new Error(`단계 ${stepId}가 제한 시간(${Math.ceil(timeoutMs / 1_000)}초)을 넘어 중단되었습니다.`),
        { code: 'step_timeout', data: { stepId, timeoutMs } },
      );
      controller.abort(error);
      reject(error);
    }, timeoutMs);
    if (parent) {
      onParentAbort = () => {
        controller.abort(parent.reason);
        reject(parent.reason instanceof Error ? parent.reason : new Error('cancelled'));
      };
      parent.addEventListener('abort', onParentAbort, { once: true });
    }
  });
  // Steps run sequentially on one context; swap the signal for this step only so
  // mutations made by the step on `ctx` still reach the run.
  ctx.abortSignal = controller.signal;
  try {
    return await Promise.race([run(), stopped]);
  } finally {
    clearTimeout(timer);
    if (onParentAbort) parent?.removeEventListener('abort', onParentAbort);
    ctx.abortSignal = parent;
  }
}
