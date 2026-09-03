import { describe, expect, it } from 'vitest';
import { DEFAULT_HTTP_ENDPOINT_ID, getHttpConnectionStatus, mergeHttpEndpointsWithSecrets, parseHttpEndpointSecrets, parseHttpEndpoints, serializeHttpEndpoints } from '../connection.js';
describe('HTTP endpoint secrets and status', () => {
  it('serializes authStored honestly instead of inferring it from the auth type', () => {
    const endpoints = parseHttpEndpoints({ endpoints: [
      { id: 'stored', baseUrl: 'https://a.example.com/', authType: 'bearer', authStored: true },
      { id: 'unstored', baseUrl: 'https://b.example.com/', authType: 'bearer' },
    ] });
    const serialized = serializeHttpEndpoints(endpoints).endpoints as Array<{ id: string; authStored: boolean }>;
    expect(serialized.find((entry) => entry.id === 'stored')?.authStored).toBe(true);
    expect(serialized.find((entry) => entry.id === 'unstored')?.authStored).toBe(false);
  });
  it('reads a legacy secret as the default endpoint secret', () => {
    expect(parseHttpEndpointSecrets({ token: 'abc' })).toEqual({ [DEFAULT_HTTP_ENDPOINT_ID]: { token: 'abc', password: undefined } });
    expect(parseHttpEndpointSecrets({ tickets: { token: 'xyz' } })).toEqual({ tickets: { token: 'xyz', password: undefined } });
  });
  it('merges per-endpoint secrets and reports connected endpoints', () => {
    const endpoints = parseHttpEndpoints({ endpoints: [
      { id: 'default', baseUrl: 'https://api.github.com/', authType: 'none' },
      { id: 'secure', baseUrl: 'https://api.example.com/', authType: 'bearer', authStored: true },
    ] });
    const merged = mergeHttpEndpointsWithSecrets(endpoints, { secure: { token: 'secret' } });
    expect(merged.map((entry) => entry.id)).toEqual(['default', 'secure']);
    expect(merged[1]?.auth?.token).toBe('secret');
    const status = getHttpConnectionStatus(serializeHttpEndpoints(endpoints), true);
    expect(status.connected).toBe(true);
    expect(status.endpoints).toHaveLength(2);
  });
});
