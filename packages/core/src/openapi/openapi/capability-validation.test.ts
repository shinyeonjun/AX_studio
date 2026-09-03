import { describe, expect, it, afterEach } from 'vitest';
import { clearDynamicCatalogForTests } from '../../catalog/dynamic-catalog.js';
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
});
