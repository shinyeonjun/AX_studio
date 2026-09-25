import { describe, expect, it } from 'vitest';
import { OpenApiConnector } from './connector.js';

describe('openapi connector URL construction', () => {
  it('rejects path parameters that could escape the operation path', async () => {
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

      expect(result).toMatchObject({ ok: false, errorCode: 'ssrf_blocked' });
      expect(requestedUrl).toBe('');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('preserves the server base path and encodes safe path parameters as one segment', async () => {
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
        { pathParams: { petId: 'pet 42?role=owner' } },
        { executionId: 'e1', variables: {}, log: () => undefined },
      );

      expect(result.ok).toBe(true);
      expect(requestedUrl).toBe('https://api.example.com/v1/pets/pet%2042%3Frole%3Downer');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
