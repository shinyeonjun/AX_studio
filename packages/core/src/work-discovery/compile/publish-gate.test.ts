import { describe, expect, it } from 'vitest';
import { canPublish } from './blueprint.js';
import { session } from './fixtures.js';
describe('compile publish gate', () => {
  it('blocks publish when replay gate fails', () => {
    const gate = canPublish({ ...session, status: 'validating', candidates: [] });
    expect(gate.ok).toBe(false);
  });

  it('blocks an auto-resolved single-example mapping until a person confirms it', () => {
    expect(canPublish({ ...session, humanConfirmedAt: undefined })).toEqual({ ok: false, reason: 'human_confirmation_required' });
    expect(canPublish(session).ok).toBe(true);
  });

  it('allows publish without confirmation once two examples reproduced the mapping', () => {
    const second = { ...session.observations[0]!, id: 'obs_2', exampleId: 'ex_2' };
    expect(canPublish({
      ...session,
      humanConfirmedAt: undefined,
      exampleIds: ['ex_1', 'ex_2'],
      observations: [...session.observations, second],
    }).ok).toBe(true);
  });
});
