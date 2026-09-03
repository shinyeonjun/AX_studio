import { afterEach, describe, expect, it } from 'vitest';
import { clearDynamicCatalogForTests } from '../../catalog/dynamic-catalog.js';
import { ingestOpenApiSpec } from '../../openapi/ingest.js';
import { setDocumentEngineClient } from '../../document-engine/engine-client.js';

describe('North Star QA connector failure logging', () => {
  afterEach(() => {
    clearDynamicCatalogForTests();
    setDocumentEngineClient(null);
  });

  it('records openapi.request_failed in execution log on HTTP error', async () => {
    const { connector } = ingestOpenApiSpec('pets', {
      openapi: '3.0.0',
      servers: [{ url: 'https://api.example.com' }],
      paths: { '/pets': { get: { operationId: 'listPets', responses: { '200': { description: 'ok' } } } } },
    });
    const logs: Array<{ message: string; data?: unknown }> = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('fail', { status: 500, statusText: 'err' });
    try {
      await connector.execute('pets.listPets', {}, {
        executionId: 'qa-openapi',
        variables: {},
        log: (entry) => logs.push({ message: entry.message, data: entry.data }),
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(logs.some((entry) => entry.message === 'openapi.request_failed')).toBe(true);
  });
});
