import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { insertDiscoveryExample, listDiscoveryExamples } from '../repositories/work-discovery-repository.js';

describe('discovery example artifact validation', () => {
  it('reports malformed artifact ids with the affected example and field', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO work_discovery_sessions
      (id, status, revision, user_goal, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run('wd_corrupt_example', 'collecting_examples', 1, '월간 보고', '{}', now, now);
    const example = insertDiscoveryExample(db, { sessionId: 'wd_corrupt_example', outputArtifactIds: ['doc_output'], inputArtifactIds: ['doc_input'] });
    db.prepare('UPDATE work_discovery_examples SET input_artifact_ids_json = ? WHERE id = ?').run('{', example.id);

    expect(() => listDiscoveryExamples(db, 'wd_corrupt_example')).toThrowError(expect.objectContaining({
      code: 'invalid_discovery_example_json', exampleId: example.id, field: 'input_artifact_ids',
    }));
    db.close?.();
  });

  it('rejects artifact id JSON that is not a string array', async () => {
    const db = await createDatabaseAsync(':memory:');
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO work_discovery_sessions
      (id, status, revision, user_goal, state_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run('wd_invalid_example', 'collecting_examples', 1, '월간 보고', '{}', now, now);
    const example = insertDiscoveryExample(db, { sessionId: 'wd_invalid_example', outputArtifactIds: ['doc_output'], inputArtifactIds: [] });
    db.prepare('UPDATE work_discovery_examples SET output_artifact_ids_json = ? WHERE id = ?').run('["doc_output", 42]', example.id);

    expect(() => listDiscoveryExamples(db, 'wd_invalid_example')).toThrowError(expect.objectContaining({
      code: 'invalid_discovery_example_artifact_ids', exampleId: example.id, field: 'output_artifact_ids',
    }));
    db.close?.();
  });
});
