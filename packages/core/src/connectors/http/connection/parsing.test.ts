import { describe, expect, it } from 'vitest';
import { DEFAULT_HTTP_ENDPOINT_ID, parseHttpEndpoints, serializeHttpEndpoints } from '../connection.js';
describe('HTTP endpoint parsing', () => {
  it('migrates a legacy single baseUrl into the default endpoint', () => {
    const endpoints = parseHttpEndpoints({ baseUrl: 'https://api.github.com/', label: 'GitHub', authType: 'none' });
    expect(endpoints).toEqual([expect.objectContaining({ id: DEFAULT_HTTP_ENDPOINT_ID, baseUrl: 'https://api.github.com/', label: 'GitHub' })]);
  });
  it('keeps multiple named endpoints', () => {
    const endpoints = parseHttpEndpoints({ endpoints: [
      { id: 'default', baseUrl: 'https://api.github.com/', label: 'GitHub' },
      { id: 'tickets', baseUrl: 'https://api.example.com/v1/', label: 'Tickets' },
    ] });
    expect(endpoints.map((entry) => entry.id)).toEqual(['default', 'tickets']);
  });

  it('persists only safe discovered read paths with the connection', () => {
    const endpoints = parseHttpEndpoints({ endpoints: [{
      id: 'catalog',
      baseUrl: 'https://api.example.test/',
      authType: 'none',
      discoveredReadOperations: [
        { path: 'products', label: 'Products' },
        { path: '../admin', label: 'Unsafe' },
        { path: 'https://evil.test/steal', label: 'Off origin' },
      ],
    }] });

    expect(endpoints[0]?.discoveredReadOperations).toEqual([{ path: 'products', label: 'Products' }]);
    expect(serializeHttpEndpoints(endpoints).endpoints).toEqual([expect.objectContaining({
      discoveredReadOperations: [{ path: 'products', label: 'Products' }],
    })]);
  });
});
