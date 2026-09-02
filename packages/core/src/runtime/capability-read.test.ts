import { describe, expect, it, vi } from 'vitest';
import { performCapabilityRead } from './capability-read.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../catalog/dynamic-catalog.js';

describe('runtime capability read boundary', () => {
  it('does not let AI investigation turn a read capability into a POST', async () => {
    const execute = vi.fn(async () => ({ ok: true, data: { unexpected: true } }));
    const result = await performCapabilityRead(
      'http.request',
      { executionId: 'investigation-1', variables: {}, log: vi.fn() },
      { http: { name: 'http', execute } },
      { method: 'POST', path: 'tickets', body: '{}' },
    );

    expect(result).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it('executes a dynamically registered read capability by its catalog action', async () => {
    registerDynamicCapabilities([{
      id: 'openapi.demo.listPets',
      connector: 'openapi',
      kind: 'read',
      label: '반려동물 목록',
      description: '반려동물 목록 조회',
      sideEffect: 'NONE',
      params: [],
    }]);
    const execute = vi.fn(async (action: string) => ({ ok: true, data: { action } }));

    try {
      await expect(performCapabilityRead(
        'openapi.demo.listPets',
        { executionId: 'investigation-2', variables: {}, log: vi.fn() },
        { openapi: { name: 'openapi', execute } },
      )).resolves.toEqual({ action: 'demo.listPets' });
      expect(execute).toHaveBeenCalledWith('demo.listPets', {}, expect.anything());
    } finally {
      clearDynamicCatalogForTests();
    }
  });
});
