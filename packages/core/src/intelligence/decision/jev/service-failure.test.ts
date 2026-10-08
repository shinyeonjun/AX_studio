import { describe, expect, it } from 'vitest';
import { decisionServiceFailure, JevDecisionError } from './errors.js';

describe('what a Jev failure means for the person', () => {
  it('tells a busy server, a rejected key and an unreachable server apart, also when wrapped', () => {
    expect(decisionServiceFailure(new JevDecisionError('TypeSafe returned invalid JSON (503).', 503))).toBe('busy');
    expect(decisionServiceFailure(new JevDecisionError('rate limited', 429))).toBe('busy');
    expect(decisionServiceFailure(new JevDecisionError('wrapped', 503, 3, new JevDecisionError('inner', 503)))).toBe('busy');
    expect(decisionServiceFailure(new Error('router', { cause: new JevDecisionError('denied', 401) }))).toBe('key_rejected');
    expect(decisionServiceFailure(new JevDecisionError('forbidden', 403))).toBe('key_rejected');
    expect(decisionServiceFailure(new TypeError('fetch failed'))).toBe('unreachable');
    expect(decisionServiceFailure(new JevDecisionError('bad request', 400))).toBeUndefined();
    expect(decisionServiceFailure(new Error('something else'))).toBeUndefined();
  });
});
