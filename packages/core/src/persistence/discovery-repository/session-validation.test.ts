import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import {
  getDiscoverySession,
  listDiscoverySessions,
} from '../repositories/work-discovery-repository.js';
import { listCorruptRows } from '../tolerant-rows.js';

describe('discovery session storage validation', () => {
  it('reports malformed session JSON with the affected session id', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO work_discovery_sessions
        (id, status, revision, user_goal, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run('wd_corrupt', 'collecting_examples', 1, '월간 보고', '{', now, now);

    expect(() => getDiscoverySession(db, 'wd_corrupt')).toThrowError(
      expect.objectContaining({ code: 'invalid_discovery_session_json', sessionId: 'wd_corrupt' }),
    );
    // The list (read by the discovery service at startup) skips and reports the row.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(listDiscoverySessions(db)).toEqual([]);
      expect(listCorruptRows(db)).toEqual([
        expect.objectContaining({ table: 'work_discovery_sessions', id: 'wd_corrupt', code: 'invalid_discovery_session_json' }),
      ]);
      expect(JSON.stringify(warn.mock.calls)).not.toContain('월간 보고');
    } finally {
      warn.mockRestore();
    }
    db.close?.();
  });

  it('rejects stored session JSON that does not match the discovery schema', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO work_discovery_sessions
        (id, status, revision, user_goal, state_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'wd_invalid',
      'collecting_examples',
      1,
      '월간 보고',
      JSON.stringify({ id: 'wd_invalid', status: 'collecting_examples' }),
      now,
      now,
    );

    expect(() => getDiscoverySession(db, 'wd_invalid')).toThrowError(
      expect.objectContaining({ code: 'invalid_discovery_session_state', sessionId: 'wd_invalid' }),
    );
    db.close?.();
  });
});
