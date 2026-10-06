import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface CrashLoopPolicy {
  /** Crashes inside the window that stop automatic recovery. */
  limit: number;
  windowMs: number;
}

/** Main-process crash relaunch: give up after 3 crashes within 5 minutes. */
export const MAIN_CRASH_POLICY: CrashLoopPolicy = Object.freeze({ limit: 3, windowMs: 5 * 60_000 });
/** Renderer reload after render-process-gone: give up after 3 losses within 1 minute. */
export const RENDERER_CRASH_POLICY: CrashLoopPolicy = Object.freeze({ limit: 3, windowMs: 60_000 });

/**
 * Records a crash at `now` and reports whether automatic recovery is still
 * allowed. Returns the pruned history so callers can persist it.
 */
export function recordCrash(
  history: readonly number[],
  now: number,
  policy: CrashLoopPolicy,
): { history: number[]; allowRecovery: boolean } {
  const recent = history.filter((at) => Number.isFinite(at) && at <= now && now - at < policy.windowMs);
  recent.push(now);
  return { history: recent.slice(-policy.limit), allowRecovery: recent.length < policy.limit };
}

/** In-memory guard for crashes that do not restart the process (renderer reloads). */
export function createCrashLoopGuard(policy: CrashLoopPolicy, clock: () => number = Date.now) {
  let history: number[] = [];
  return {
    record(): boolean {
      const result = recordCrash(history, clock(), policy);
      history = result.history;
      return result.allowRecovery;
    },
  };
}

/**
 * Guard whose history survives `app.relaunch()`. Uses synchronous I/O on
 * purpose: it runs from an uncaughtException handler right before exit.
 */
export function recordPersistentCrash(
  historyFile: string,
  policy: CrashLoopPolicy,
  now: number = Date.now(),
): boolean {
  let previous: number[] = [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(historyFile, 'utf8'));
    if (Array.isArray(parsed)) previous = parsed.filter((value): value is number => typeof value === 'number');
  } catch {
    // Missing or corrupt history counts as no previous crashes.
  }
  const result = recordCrash(previous, now, policy);
  try {
    mkdirSync(dirname(historyFile), { recursive: true });
    writeFileSync(historyFile, JSON.stringify(result.history), 'utf8');
  } catch {
    // Without persistence the in-process decision still holds.
  }
  return result.allowRecovery;
}

export function readCrashHistory(historyFile: string): number[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(historyFile, 'utf8'));
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : [];
  } catch {
    return [];
  }
}
