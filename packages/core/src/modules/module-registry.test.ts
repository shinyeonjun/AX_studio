import { describe, expect, it } from 'vitest';
import { listRegisteredModules, registerModule } from '../modules/module-registry.js';
import '../modules/register-defaults.js';

describe('registerModule', () => {
  it('registers built-in modules', () => {
    const ids = listRegisteredModules().map((module) => module.id);
    expect(ids).toContain('gmail');
    expect(ids).toContain('slack');
    expect(ids).toContain('transform');
  });

  it('allows additional module registration', () => {
    const before = listRegisteredModules().length;
    registerModule({
      id: 'transform',
      createMock: () => ({ name: 'transform', execute: async () => ({ ok: true }) }),
    });
    expect(listRegisteredModules().length).toBe(before);
  });
});
