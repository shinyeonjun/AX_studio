import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { CursorSessions } from './cursor-sessions.js';
it('owns generated paths, prevents concurrent writes, and defers active cleanup', async () => {
  const sessions = new CursorSessions();
  const first = await sessions.acquire('../../not-a-path');
  try {
    expect(first.dir).not.toContain('not-a-path');
    await expect(sessions.acquire('../../not-a-path')).rejects.toThrow('provider_session_busy');
    first.remember('resume-token'); await first.release();
    const resumed = await sessions.acquire('../../not-a-path');
    expect(resumed.resume).toBe('resume-token');
    await sessions.dispose(); expect(existsSync(resumed.dir)).toBe(true);
    await resumed.release(); expect(existsSync(resumed.dir)).toBe(false);
    await expect(sessions.acquire('new')).rejects.toThrow('provider_disposed');
  } finally { await first.release(); await sessions.dispose(); }
});
it('evicts only idle owned workspaces at capacity', async () => {
  const sessions = new CursorSessions(); const handles = [];
  try {
    for (let i = 0; i < 32; i++) handles.push(await sessions.acquire(String(i)));
    await expect(sessions.acquire('overflow')).rejects.toThrow('provider_sessions_full');
    await handles[0]!.release();
    const next = await sessions.acquire('next'); handles.push(next);
    expect(existsSync(handles[0]!.dir)).toBe(false);
    expect(existsSync(handles[1]!.dir)).toBe(true);
  } finally { await Promise.all(handles.map(handle => handle.release())); await sessions.dispose(); }
});
