let tail: Promise<unknown> = Promise.resolve();

/**
 * Serialize read-modify-write updates of the single persisted RDB connection
 * (database list + OS secret map). Every critical section re-reads state after
 * acquiring the lock, so concurrent connects/disconnects cannot drop databases.
 */
export function withRdbConnectionLock<T>(operation: () => Promise<T>): Promise<T> {
  const run = tail.then(operation, operation);
  tail = run.catch(() => undefined);
  return run;
}
