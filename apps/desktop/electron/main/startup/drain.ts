/**
 * Bounds the whole shutdown, not just the final ingestion stage. When `labels` are given,
 * `onIncomplete` receives the stages that timed out, failed or returned false, so a slow
 * shutdown can be diagnosed from the log instead of only "timed out".
 */
export async function drainWithin(
  tasks: Array<() => Promise<unknown>>,
  timeoutMs: number,
  labels?: readonly string[],
  onIncomplete?: (stages: string[]) => void,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settleDeadline!: (drained: boolean) => void;
  const outcome: Array<'pending' | 'ok' | 'failed'> = tasks.map(() => 'pending');
  const deadline = new Promise<boolean>(resolve => {
    settleDeadline = resolve;
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    const drained = await Promise.race([
      Promise.allSettled(tasks.map((task, index) => Promise.resolve().then(task).then(
        (value) => { outcome[index] = value === false ? 'failed' : 'ok'; return value; },
        (error: unknown) => { outcome[index] = 'failed'; throw error; },
      ))).then(results => results.every(result => result.status === 'fulfilled' && result.value !== false)),
      deadline,
    ]);
    if (!drained && onIncomplete) {
      onIncomplete(outcome.flatMap((state, index) => state === 'ok' ? [] : [`${labels?.[index] ?? `task_${index}`}:${state === 'pending' ? 'timeout' : 'failed'}`]));
    }
    return drained;
  } finally {
    clearTimeout(timer);
    settleDeadline(false);
  }
}
