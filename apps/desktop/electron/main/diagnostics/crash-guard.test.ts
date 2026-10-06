import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createCrashLoopGuard,
  MAIN_CRASH_POLICY,
  readCrashHistory,
  recordCrash,
  recordPersistentCrash,
} from './crash-guard.js';

const MINUTE = 60_000;

describe('crash loop guard', () => {
  it('stops recovery on the third crash inside the window', () => {
    let history: number[] = [];
    const decisions = [0, MINUTE, 2 * MINUTE].map((at) => {
      const result = recordCrash(history, at, MAIN_CRASH_POLICY);
      history = result.history;
      return result.allowRecovery;
    });
    expect(decisions).toEqual([true, true, false]);
  });

  it('forgets crashes older than the window', () => {
    const result = recordCrash([0, MINUTE], 7 * MINUTE, MAIN_CRASH_POLICY);
    expect(result).toEqual({ history: [7 * MINUTE], allowRecovery: true });
  });

  it('ignores timestamps from the future (clock changes) and non-numbers', () => {
    expect(recordCrash([Number.NaN, 10 * MINUTE], MINUTE, MAIN_CRASH_POLICY).allowRecovery).toBe(true);
  });

  it('tracks in-memory renderer crashes with an injectable clock', () => {
    let now = 0;
    const guard = createCrashLoopGuard({ limit: 2, windowMs: 1_000 }, () => now);
    expect(guard.record()).toBe(true);
    now = 500;
    expect(guard.record()).toBe(false);
    now = 5_000;
    expect(guard.record()).toBe(true);
  });

  it('persists history across relaunches and tolerates a corrupt file', () => {
    const directory = mkdtempSync(join(tmpdir(), 'ax-crash-'));
    try {
      const file = join(directory, 'nested', 'crash-history.json');
      expect(recordPersistentCrash(file, MAIN_CRASH_POLICY, 1_000)).toBe(true);
      expect(recordPersistentCrash(file, MAIN_CRASH_POLICY, 2_000)).toBe(true);
      expect(recordPersistentCrash(file, MAIN_CRASH_POLICY, 3_000)).toBe(false);
      expect(readCrashHistory(file)).toEqual([1_000, 2_000, 3_000]);
      writeFileSync(file, '{not json');
      expect(readCrashHistory(file)).toEqual([]);
      expect(recordPersistentCrash(file, MAIN_CRASH_POLICY, 4_000)).toBe(true);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
