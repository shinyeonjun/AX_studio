import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import {
  getDiscoverySession,
  listDiscoverySessions,
} from '../repositories/work-discovery-repository.js';

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
    expect(() => listDiscoverySessions(db)).toThrowError(
      expect.objectContaining({ code: 'invalid_discovery_session_json', sessionId: 'wd_corrupt' }),
    );
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
