import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HTTP_ENDPOINT_ID,
  getHttpConnectionStatus,
  matchHttpEndpoint,
  mergeHttpEndpointsWithSecrets,
  parseHttpEndpointSecrets,
  parseHttpEndpoints,
  removeHttpEndpoint,
  serializeHttpEndpoints,
  upsertHttpEndpoint,
} from './connection.js';

describe('HTTP endpoint config', () => {
  it('migrates a legacy single baseUrl into the default endpoint', () => {
    const endpoints = parseHttpEndpoints({
      baseUrl: 'https://api.github.com/',
      label: 'GitHub',
      authType: 'none',
    });
    expect(endpoints).toEqual([
      expect.objectContaining({
        id: DEFAULT_HTTP_ENDPOINT_ID,
        baseUrl: 'https://api.github.com/',
        label: 'GitHub',
      }),
    ]);
  });

  it('keeps multiple named endpoints', () => {
    const endpoints = parseHttpEndpoints({
      endpoints: [
        { id: 'default', baseUrl: 'https://api.github.com/', label: 'GitHub' },
        { id: 'tickets', baseUrl: 'https://api.example.com/v1/', label: 'Tickets' },
      ],
    });
    expect(endpoints.map((entry) => entry.id)).toEqual(['default', 'tickets']);
  });

  it('upserts by id or matching base URL and can remove one endpoint', () => {
    const first = upsertHttpEndpoint(undefined, {
      id: 'default',
      baseUrl: 'https://api.github.com/',
      auth: { type: 'none' },
    });
    const two = upsertHttpEndpoint(serializeHttpEndpoints(first), {
      id: 'tickets',
      baseUrl: 'https://api.example.com/v1/',
      label: 'Tickets',
      auth: { type: 'none' },
    });
    expect(two).toHaveLength(2);
    expect(removeHttpEndpoint(serializeHttpEndpoints(two), 'tickets')).toHaveLength(1);
  });

  it('serializes authStored honestly instead of inferring it from the auth type', () => {
    const endpoints = parseHttpEndpoints({
      endpoints: [
        { id: 'stored', baseUrl: 'https://a.example.com/', authType: 'bearer', authStored: true },
        { id: 'unstored', baseUrl: 'https://b.example.com/', authType: 'bearer' },
      ],
    });
    const serialized = serializeHttpEndpoints(endpoints).endpoints as Array<{ id: string; authStored: boolean }>;
    expect(serialized.find((entry) => entry.id === 'stored')?.authStored).toBe(true);
    expect(serialized.find((entry) => entry.id === 'unstored')?.authStored).toBe(false);
  });

  it('upserts by id before base URL so editing cannot merge into another endpoint', () => {
    const config = serializeHttpEndpoints(parseHttpEndpoints({
      endpoints: [
        { id: 'a', baseUrl: 'https://a.example.com/', label: 'A' },
        { id: 'b', baseUrl: 'https://b.example.com/', label: 'B' },
      ],
    }));
    // Editing endpoint "a" onto b's base URL must update "a", not "b".
    const next = upsertHttpEndpoint(config, {
      id: 'a',
      baseUrl: 'https://b.example.com/',
      label: 'A2',
      auth: { type: 'none' },
    });
    expect(next.find((entry) => entry.id === 'a')).toMatchObject({ baseUrl: 'https://b.example.com/', label: 'A2' });
    expect(next.find((entry) => entry.id === 'b')).toMatchObject({ label: 'B' });
  });

  it('reads a legacy secret as the default endpoint secret', () => {
    expect(parseHttpEndpointSecrets({ token: 'abc' })).toEqual({
      [DEFAULT_HTTP_ENDPOINT_ID]: { token: 'abc', password: undefined },
    });
    expect(parseHttpEndpointSecrets({ tickets: { token: 'xyz' } })).toEqual({
      tickets: { token: 'xyz', password: undefined },
    });
  });

  it('merges per-endpoint secrets and reports connected endpoints', () => {
    const endpoints = parseHttpEndpoints({
      endpoints: [
        { id: 'default', baseUrl: 'https://api.github.com/', authType: 'none' },
        { id: 'secure', baseUrl: 'https://api.example.com/', authType: 'bearer', authStored: true },
      ],
    });
    const merged = mergeHttpEndpointsWithSecrets(endpoints, { secure: { token: 'secret' } });
    expect(merged.map((entry) => entry.id)).toEqual(['default', 'secure']);
    expect(merged[1]?.auth?.token).toBe('secret');

    const status = getHttpConnectionStatus(serializeHttpEndpoints(endpoints), true);
    expect(status.connected).toBe(true);
    expect(status.endpoints).toHaveLength(2);
  });

  it('matches a saved connection by id, label, or base URL', () => {
    const endpoints = parseHttpEndpoints({
      endpoints: [
        { id: 'default', baseUrl: 'https://api.github.com/', label: 'GitHub' },
        { id: 'tickets', baseUrl: 'https://api.example.com/v1/', label: 'Tickets' },
      ],
    });
    expect(matchHttpEndpoint(endpoints, 'tickets')?.id).toBe('tickets');
    expect(matchHttpEndpoint(endpoints, 'GitHub')?.id).toBe('default');
    expect(matchHttpEndpoint(endpoints)?.id).toBe('default');
  });
});
