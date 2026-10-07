/**
 * Load now and again after app state broadcasts, without piling up requests: at most one load
 * runs at a time, any broadcasts during it collapse into one follow-up load, and a load that
 * returns `true` (its result can no longer change) stops listening. Returns the stop function.
 */
export function reloadOnStateChange(load: () => Promise<boolean | void>): () => void {
  let stopped = false;
  let running = false;
  let again = false;
  let unsubscribe: (() => void) | undefined;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    unsubscribe?.();
  };
  const run = async () => {
    if (stopped) return;
    if (running) { again = true; return; }
    running = true;
    try {
      do {
        again = false;
        let settled = false;
        try { settled = await load() === true; } catch { /* A failed load may succeed on the next broadcast. */ }
        if (settled) { stop(); return; }
      } while (again && !stopped);
    } finally { running = false; }
  };
  unsubscribe = window.ax.onStateChanged(() => { void run(); });
  void run();
  return stop;
}
