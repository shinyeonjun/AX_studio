import { describe, expect, it } from 'vitest';
import { resolveEffectiveSideEffect } from '../workflow/side-effect-resolve.js';
import type { ActionDefinition } from '../workflow/action-definition.js';

const httpRequest: ActionDefinition = {
  id: 'http.request',
  version: 1,
  connector: 'http',
  action: 'request',
  kind: 'read',
  sideEffect: undefined,
  params: [],
};

describe('resolveEffectiveSideEffect', () => {
  it('defaults GET to NONE for http.request', () => {
    expect(resolveEffectiveSideEffect(httpRequest, { method: 'GET' })).toBe('NONE');
  });

  it('defaults POST to EXTERNAL for http.request', () => {
    expect(resolveEffectiveSideEffect(httpRequest, { method: 'POST' })).toBe('EXTERNAL');
  });

  it('uses catalog sideEffect when set', () => {
    const fixed = { ...httpRequest, sideEffect: 'EXTERNAL_HIGH' as const };
    expect(resolveEffectiveSideEffect(fixed, { method: 'GET' })).toBe('EXTERNAL_HIGH');
  });
});
