import { describe, expect, it, afterEach } from 'vitest';
import { clearDynamicCatalogForTests } from '../../catalog/dynamic-catalog.js';
import { getCapability } from '../../catalog/capabilities.js';
import { invokeReadCapability } from '../../design-tools/capability-invoke.js';
import { buildDesignToolContext } from '../../design-tools/context.js';
import { ingestOpenApiSpec } from '../ingest.js';

const PETSTORE = {
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  servers: [{ url: 'https://api.example.com' }],
  paths: {
    '/pets': {
      get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } },
      head: { operationId: 'checkPets', responses: { '200': { description: 'ok' } } },
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
    expect(capabilityIds).toContain('openapi.petstore.checkPets');
    expect(getCapability('openapi.petstore.checkPets')?.kind).toBe('read');
    expect(getCapability('openapi.petstore.checkPets')?.sideEffect).toBe('NONE');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(JSON.stringify([{ id: 1, name: 'cat' }]), { status: 200 });

    try {
      const ctx = buildDesignToolContext([], ['openapi'], {
        connectors: { openapi: connector },
      });
      const result = await invokeReadCapability(ctx, 'openapi.petstore.listPets', {});
      expect(result.capabilityId).toBe('openapi.petstore.listPets');
      expect((result.data as { status: number }).status).toBe(200);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('invokes HEAD operations without a response body', async () => {
    const { connector } = ingestOpenApiSpec('petstore', PETSTORE);
    const originalFetch = globalThis.fetch;
    let requestedMethod = '';
    globalThis.fetch = async (_input, init) => {
      requestedMethod = init?.method ?? '';
      return new Response(null, { status: 200 });
    };

    try {
      const result = await connector.execute(
        'petstore.checkPets',
        {},
        { executionId: 'e1', variables: {}, log: () => undefined },
      );

      expect(result.ok).toBe(true);
      expect(requestedMethod).toBe('HEAD');
      expect(result.data).toMatchObject({ status: 200, body: '' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('invokes operations whose OpenAPI operationId contains dots', async () => {
    const spec = {
      ...PETSTORE,
      paths: {
        '/pets': {
          get: { operationId: 'pets.list', responses: { '200': { description: 'ok' } } },
        },
      },
    };
    const { connector, capabilityIds } = ingestOpenApiSpec('petstore', spec);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 200 });

    try {
      expect(capabilityIds).toContain('openapi.petstore.pets.list');
      const result = await connector.execute(
        'petstore.pets.list',
        {},
        { executionId: 'e1', variables: {}, log: () => undefined },
      );

      expect(result.ok).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
