import { describe, expect, it } from 'vitest';
import { listRegisteredModules, registerModule } from '../modules/module-registry.js';
import { instantiateConnector } from '../modules/registry.js';
import { registerAllModules } from './packages/register.js';

describe('registerModule', () => {
  it('registers built-in modules', () => {
    registerAllModules();
    const ids = listRegisteredModules().map((module) => module.id);
    expect(ids).toContain('gmail');
    expect(ids).toContain('slack');
    expect(ids).toContain('transform');
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
