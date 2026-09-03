import { describe, expect, it } from 'vitest';
import { availableCapabilities, designCapabilities, resolveCapability } from '../capability-graph.js';
import { triggerCapabilityId } from '../capability-contracts.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../dynamic-catalog.js';
describe('capability graph dynamic catalog', () => {
  it('resolves and exposes dynamically registered capabilities', () => {
    registerDynamicCapabilities([
      {
        id: 'openapi.demo.listPets',
        connector: 'openapi',
        kind: 'read',
        label: '반려동물 목록',
        description: '반려동물 목록 조회',
        sideEffect: 'NONE',
        params: [],
      },
      {
        id: 'mcp.demo.newEvent',
        connector: 'mcp',
        kind: 'trigger',
        label: '새 이벤트',
        description: '새 이벤트 수신',
        params: [],
      },
    ]);
    try {
      expect(resolveCapability('openapi', 'demo.listPets')?.label).toBe('반려동물 목록');
      expect(designCapabilities().some((cap) => cap.id === 'openapi.demo.listPets')).toBe(true);
      expect(availableCapabilities(['openapi']).some((cap) => cap.id === 'openapi.demo.listPets')).toBe(true);
      expect(triggerCapabilityId('mcp.demo.newEvent')).toBe('mcp.demo.newEvent');
    } finally {
      clearDynamicCatalogForTests();
    }
  });
  it('does not resolve dynamic actions by an ambiguous suffix', () => {
    registerDynamicCapabilities([
      {
        id: 'openapi.alpha.listPets',
        connector: 'openapi',
        kind: 'read',
        label: 'Alpha 반려동물 목록',
        description: 'Alpha 반려동물 목록 조회',
        sideEffect: 'NONE',
        params: [],
      },
      {
        id: 'openapi.beta.listPets',
        connector: 'openapi',
        kind: 'read',
        label: 'Beta 반려동물 목록',
        description: 'Beta 반려동물 목록 조회',
        sideEffect: 'NONE',
        params: [],
      },
    ]);

    try {
      expect(resolveCapability('openapi', 'alpha.listPets')?.id).toBe('openapi.alpha.listPets');
      expect(resolveCapability('openapi', 'beta.listPets')?.id).toBe('openapi.beta.listPets');
      expect(resolveCapability('openapi', 'listPets')).toBeUndefined();
    } finally {
      clearDynamicCatalogForTests();
    }
  });
});
