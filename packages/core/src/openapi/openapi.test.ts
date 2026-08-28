import { describe, expect, it, afterEach } from 'vitest';
import { clearDynamicCatalogForTests } from '../catalog/dynamic-catalog.js';
import { getCapability } from '../catalog/capabilities.js';
import { invokeReadCapability } from '../design-tools/capability-invoke.js';
import { buildDesignToolContext } from '../design-tools/context.js';
import { OpenApiConnector } from './connector.js';
import { ingestOpenApiSpec } from './ingest.js';

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

  it('blocks write capabilities in plain chat', async () => {
    ingestOpenApiSpec('petstore', PETSTORE);
    const ctx = buildDesignToolContext([], ['mcp'], { connectors: {} });
    await expect(
      invokeReadCapability(ctx, 'openapi.petstore.createPet', {}),
    ).rejects.toThrow('capability_not_readable');
  });

  it('rejects duplicate explicit operation ids', () => {
    expect(() => ingestOpenApiSpec('petstore', {
      ...PETSTORE,
      paths: {
        '/pets': { get: { operationId: 'findPet' } },
        '/pets/{petId}': { get: { operationId: 'findPet' } },
      },
    })).toThrow('openapi_operation_id_duplicate');
  });

  it('rejects collisions between generated operation ids', () => {
    expect(() => ingestOpenApiSpec('petstore', {
      ...PETSTORE,
      paths: {
        '/pet-list': { get: {} },
        '/pet/list': { get: {} },
      },
    })).toThrow('openapi_operation_id_duplicate');
  });

  it('preserves the server base path and encodes path parameters as a single URL segment', async () => {
    const connector = new OpenApiConnector([{
      id: 'petstore',
      title: 'Petstore',
      baseUrl: 'https://api.example.com/v1',
      operations: [{ operationId: 'getPet', method: 'GET', path: '/pets/{petId}' }],
    }]);
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    globalThis.fetch = async (input) => {
      requestedUrl = input.toString();
      return new Response('{}', { status: 200 });
    };

    try {
      const result = await connector.execute(
        'petstore.getPet',
        { pathParams: { petId: '../admin?role=owner' } },
        { executionId: 'e1', variables: {}, log: () => undefined },
      );

      expect(result.ok).toBe(true);
      expect(requestedUrl).toBe('https://api.example.com/v1/pets/..%2Fadmin%3Frole%3Downer');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
