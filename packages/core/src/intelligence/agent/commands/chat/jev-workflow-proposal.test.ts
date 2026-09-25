import { describe, expect, it } from 'vitest';
import { selectJevWorkflowTriggerHints } from './jev-workflow-proposal.js';

describe('selectJevWorkflowTriggerHints', () => {
  it('offers only event triggers from connected connector capabilities', () => {
    const gmail = selectJevWorkflowTriggerHints(['gmail']);
    expect(gmail).toHaveLength(1);
    expect(gmail[0]).toMatchObject({
      capability: { connector: 'gmail', kind: 'trigger' },
      trigger: { type: 'gmail.new_message', accountId: '' },
    });
    expect(gmail.some((hint) => hint.trigger.type === 'slack.new_message')).toBe(false);
  });

  it('returns no event triggers when none of their connectors are connected', () => {
    expect(selectJevWorkflowTriggerHints([])).toEqual([]);
  });

  it('does not offer webhook until its target can be resolved by the proposal host', () => {
    expect(selectJevWorkflowTriggerHints(['webhook'])).toEqual([]);
  });
});
