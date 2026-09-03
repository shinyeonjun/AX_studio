import { describe, expect, it } from 'vitest';
import { canPublish } from './blueprint.js';
import { session } from './fixtures.js';
describe('compile publish gate', () => {
  it('blocks publish when replay gate fails', () => {
    const gate = canPublish({ ...session, status: 'validating', candidates: [] });
    expect(gate.ok).toBe(false);
  });
});
