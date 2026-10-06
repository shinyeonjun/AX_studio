let tail: Promise<unknown> = Promise.resolve();

/**
 * Serialize read-modify-write updates of the single persisted HTTP connection
 * (endpoint list + OS secret blob). Every critical section re-reads state after
 * acquiring the lock, so concurrent connects/disconnects cannot drop endpoints.
 */
export function withHttpConnectionLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = tail.then(operation, operation);
  tail = run.catch(() => undefined);
  return run;
}
