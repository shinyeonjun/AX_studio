import { describe, expect, it } from 'vitest';
import { listRegisteredModules, registerModule } from './module-registry.js';
import { createAlwaysRealConnectors, instantiateConnector } from './registry.js';
import { registerAllModules } from './packages/register.js';

describe('registerModule', () => {
  it('registers built-in modules', () => {
    registerAllModules();
    const ids = listRegisteredModules().map((module) => module.id);
    expect(ids).toContain('gmail');
    expect(ids).toContain('slack');
    expect(ids).toContain('transform');
  });

  it('instantiates built-in connectors that are available without a saved connection', () => {
    registerAllModules();

    expect(createAlwaysRealConnectors()).toHaveProperty('local_sheet');
  });

  it('allows additional module registration', () => {
    const before = listRegisteredModules().length;
    registerModule({
      id: 'transform',
      instantiate: () => ({ name: 'transform', execute: async () => ({ ok: true }) }),
    });
    expect(listRegisteredModules().length).toBe(before);
  });

  it('does not instantiate Slack from a malformed token config', () => {
    expect(instantiateConnector('slack', { token: 123 })).toBeNull();
  });
});
