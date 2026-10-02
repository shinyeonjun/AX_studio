import { afterEach, describe, expect, it, vi } from 'vitest';
import { JevDecisionError } from '@ax-studio/core';
import { createStartupJevDecisionEngine } from './jev.js';

afterEach(() => vi.restoreAllMocks());

describe('Jev startup boundary with synthetic settings only', () => {
  it('disables a malformed persisted key without fetching or logging the key', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected fetch'));
    const warn = vi.fn();
    const syntheticKey = '새로운-synthetic-key';
    expect(createStartupJevDecisionEngine({ enabled: true }, { TYPESAFE_API_KEY: syntheticKey }, warn)).toBeUndefined();
    expect(network).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toContain('Update Jev settings');
    expect(warn.mock.calls[0]?.[0]).not.toContain(syntheticKey);
  });

  it('also disables an invalid experiment key and preserves raw whitespace', () => {
    const warn = vi.fn();
    expect(createStartupJevDecisionEngine(undefined,
      { AX_EXPERIMENT_JEV_DECISION_PLANE: '1', TYPESAFE_API_KEY: ' synthetic-key ' }, warn)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('constructs a valid synthetic engine without authenticating', () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('unexpected fetch'));
    const engine = createStartupJevDecisionEngine({ enabled: true }, { TYPESAFE_API_KEY: 'synthetic-key' }, vi.fn());
    expect(engine?.evaluate).toBeTypeOf('function');
    expect(network).not.toHaveBeenCalled();
    expect(JevDecisionError).toBeTypeOf('function');
  });
});
