import { describe, expect, it, afterEach } from 'vitest';
import { clearDynamicCatalogForTests } from '../../../catalog/dynamic-catalog.js';
import { getCapability } from '../../../catalog/capabilities.js';
import { invokeReadCapability } from '../../../intelligence/design-tools/capability-invoke.js';
import { buildDesignToolContext } from '../../../intelligence/design-tools/context.js';
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

  it('removes stale capabilities when the singleton OpenAPI connection is replaced', () => {
    ingestOpenApiSpec('old_api', PETSTORE);
    ingestOpenApiSpec('new_api', {
      ...PETSTORE,
      paths: { '/pets': { get: { operationId: 'searchPets', responses: { '200': { description: 'ok' } } } } },
    });

    expect(getCapability('openapi.old_api.listPets')).toBeUndefined();
    expect(getCapability('openapi.new_api.searchPets')).toBeDefined();
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

  it('serializes object bodies, forwards headers, and passes cancellation to fetch', async () => {
    const { connector } = ingestOpenApiSpec('petstore', PETSTORE);
    const originalFetch = globalThis.fetch;
    let requestInit: RequestInit | undefined;
    globalThis.fetch = async (_input, init) => {
      requestInit = init;
      return new Response('{}', { status: 201 });
    };
    const abortController = new AbortController();

    try {
      const result = await connector.execute(
        'petstore.createPet',
        { body: { name: 'cat' }, headers: { Authorization: 'Bearer test' } },
        { executionId: 'e1', variables: {}, log: () => undefined, abortSignal: abortController.signal },
      );

      expect(result.ok).toBe(true);
      expect(requestInit?.method).toBe('POST');
      expect(requestInit?.headers).toMatchObject({ Authorization: 'Bearer test', 'content-type': 'application/json' });
      expect(JSON.parse(String(requestInit?.body))).toEqual({ name: 'cat' });
      expect(requestInit?.signal).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('does not invoke an operation with declared security before headers are supplied', async () => {
    const { connector } = ingestOpenApiSpec('secure', {
      openapi: '3.0.0',
      info: { title: 'Secure API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com/v1?token=must-not-leak' }],
      security: [{ bearerAuth: [] }],
      paths: { '/pets': { get: { operationId: 'listPets' } } },
    });
    const result = await connector.execute(
      'secure.listPets',
      {},
      { executionId: 'e1', variables: {}, log: () => undefined },
    );

    expect(result).toMatchObject({ ok: false, errorCode: 'invalid_params', error: 'openapi_security_headers_required' });
  });

  it('enforces declared parameters and maps cookie parameters to the request', async () => {
    const { connector } = ingestOpenApiSpec('params', {
      openapi: '3.0.0',
      info: { title: 'Params', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com/v1' }],
      paths: {
        '/pets/{petId}': {
          get: {
            operationId: 'getPet',
            parameters: [
              { name: 'petId', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'tenant', in: 'cookie', required: true, schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    });
    const originalFetch = globalThis.fetch;
    let requestedUrl = '';
    let requestedHeaders: HeadersInit | undefined;
    globalThis.fetch = async (input, init) => {
      requestedUrl = String(input);
      requestedHeaders = init?.headers;
      return new Response('{}', { status: 200 });
    };

    try {
      await expect(connector.execute('params.getPet', {}, { executionId: 'e1', variables: {}, log: () => undefined }))
        .resolves.toMatchObject({ ok: false, error: 'openapi_required_parameter_missing:path:petId' });
      await expect(connector.execute(
        'params.getPet',
        { pathParams: { petId: 'p-1' }, cookies: { tenant: 'acme' } },
        { executionId: 'e1', variables: {}, log: () => undefined },
      )).resolves.toMatchObject({ ok: true });
      expect(requestedUrl).toBe('https://api.example.com/v1/pets/p-1');
      expect(requestedHeaders).toMatchObject({ cookie: 'tenant=acme' });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
