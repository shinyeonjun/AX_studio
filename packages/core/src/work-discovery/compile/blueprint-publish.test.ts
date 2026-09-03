import { describe, expect, it } from 'vitest';
import { buildDiscoveryBlueprint, canPublish } from './blueprint.js';
import { session } from './fixtures.js';
describe('compile blueprint publish', () => {
  it('builds a publishable blueprint from accepted candidates', () => {
    const blueprint = buildDiscoveryBlueprint(session);
    expect(blueprint?.publishable).toBe(true);
    expect(blueprint?.fields).toHaveLength(1);
    expect(blueprint?.outputContract).toMatchObject({
      version: 1,
      fields: [{
        path: 'field.total',
        kind: 'number',
        baseline: { sampleCount: 1, numericMin: 100, numericMax: 100 },
      }],
    });
    expect(canPublish({ ...session, blueprint }).ok).toBe(true);
  });
});
