import { describe, expect, it, afterEach } from 'vitest';
import { getCapability } from '../../../catalog/capabilities.js';
import { clearDynamicCatalogForTests } from '../../../catalog/dynamic-catalog.js';
import { invokeReadCapability } from '../../../intelligence/design-tools/capability-invoke.js';
import { buildDesignToolContext } from '../../../intelligence/design-tools/context.js';
import { summarizeApprovalGates } from '../../../workflow/approval-gates.js';
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

  it('blocks write capabilities in plain chat', async () => {
    ingestOpenApiSpec('petstore', PETSTORE);
    const ctx = buildDesignToolContext([], ['mcp'], { connectors: {} });
    await expect(
      invokeReadCapability(ctx, 'openapi.petstore.createPet', {}),
    ).rejects.toThrow('capability_not_readable');
  });

  it('does not let POST + x-sideEffect NONE bypass read or approval policy', async () => {
    ingestOpenApiSpec('unsafe', {
      openapi: '3.0.0',
      info: { title: 'Unsafe API', version: '1.0.0' },
      servers: [{ url: 'https://api.example.com' }],
      paths: {
        '/pets': {
          post: {
            operationId: 'createPet',
            'x-sideEffect': 'NONE',
            responses: { '201': { description: 'created' } },
          },
        },
      },
    });

    expect(getCapability('openapi.unsafe.createPet')).toMatchObject({
      kind: 'write',
      sideEffect: 'EXTERNAL',
    });

    const ctx = buildDesignToolContext([], ['mcp'], { connectors: {} });
    await expect(
      invokeReadCapability(ctx, 'openapi.unsafe.createPet', {}),
    ).rejects.toThrow('capability_not_readable');

    expect(summarizeApprovalGates({
      steps: [{
        type: 'action',
        id: 'create-pet',
        actionRef: 'openapi.unsafe.createPet@1',
        connector: 'openapi',
        action: 'unsafe.createPet',
        params: {},
        // A stale or forged workflow value must not downgrade catalog policy.
        sideEffect: 'NONE',
      }],
    })).toMatchObject({
      gates: [{ stepId: 'create-pet', sideEffect: 'EXTERNAL', requiresApproval: true }],
    });
  });

  it('preserves explicit high-risk classification on read-shaped methods', () => {
    const { capabilityIds } = ingestOpenApiSpec('high-risk-read', {
      ...PETSTORE,
      paths: {
        '/audit': {
          get: {
            operationId: 'audit',
            'x-sideEffect': 'EXTERNAL_HIGH',
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    });

    expect(getCapability(capabilityIds[0])?.sideEffect).toBe('EXTERNAL_HIGH');
    expect(getCapability(capabilityIds[0])?.kind).toBe('write');
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

  it('rejects private server metadata before registering operations', () => {
    expect(() => ingestOpenApiSpec('private', {
      ...PETSTORE,
      servers: [{ url: 'http://127.0.0.1:8080/internal' }],
    })).toThrow('openapi_private_base_url');
  });
});
