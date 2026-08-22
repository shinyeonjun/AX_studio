import { describe, expect, it, afterEach } from 'vitest';
import { clearDynamicCatalogForTests } from '../catalog/dynamic-catalog.js';
import { getCapability } from '../catalog/capabilities.js';
import { invokeReadCapability } from '../design-tools/capability-invoke.js';
import { buildDesignToolContext } from '../design-tools/context.js';
import { ingestOpenApiSpec } from './ingest.js';

const PETSTORE = {
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/pets': {
      get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } },
      post: {
        operationId: 'createPet',
        'x-sideEffect': 'EXTERNAL',
        responses: { '201': { description: 'created' } },
      },
    },
  },
};

describe('openapi ingest', () => {
  afterEach(() => {
    clearDynamicCatalogForTests();
  });

  it('registers capabilities and invokes read operations through the connector adapter', async () => {
    const { connector, capabilityIds } = ingestOpenApiSpec('petstore', PETSTORE);
    expect(capabilityIds).toContain('openapi.petstore.listPets');
    expect(getCapability('openapi.petstore.listPets')?.sideEffect).toBe('NONE');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify([{ id: 1, name: 'cat' }]), { status: 200 });

    try {
      const ctx = buildDesignToolContext([], ['openapi'], undefined, {
        connectors: { openapi: connector },
      });
      const result = await invokeReadCapability(ctx, 'openapi.petstore.listPets', {}, 'plain_chat');
      expect(result.capabilityId).toBe('openapi.petstore.listPets');
      expect((result.data as { status: number }).status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('blocks write capabilities in plain chat', async () => {
    ingestOpenApiSpec('petstore', PETSTORE);
    const ctx = buildDesignToolContext([], ['mcp'], undefined, { connectors: {} });
    await expect(
      invokeReadCapability(ctx, 'openapi.petstore.createPet', {}, 'plain_chat'),
    ).rejects.toThrow('capability_not_readable');
  });
});
