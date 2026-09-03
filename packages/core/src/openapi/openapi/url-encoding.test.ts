import { describe, expect, it } from 'vitest';
import { OpenApiConnector } from '../connector.js';

describe('openapi connector URL construction', () => {
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
