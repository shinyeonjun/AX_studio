/** Bounds the whole shutdown, not just the final ingestion stage. */
export async function drainWithin(tasks: Array<() => Promise<unknown>>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.allSettled(tasks.map(task => Promise.resolve().then(task)))
        .then(results => results.every(result => result.status === 'fulfilled' && result.value !== false)),
      new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}
