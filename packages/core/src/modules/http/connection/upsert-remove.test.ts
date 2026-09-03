import { describe, expect, it } from 'vitest';
import { parseHttpEndpoints, removeHttpEndpoint, serializeHttpEndpoints, upsertHttpEndpoint } from '../connection.js';
describe('HTTP endpoint mutation', () => {
  it('upserts by id or matching base URL and can remove one endpoint', () => {
    const first = upsertHttpEndpoint(undefined, { id: 'default', baseUrl: 'https://api.github.com/', auth: { type: 'none' } });
    const two = upsertHttpEndpoint(serializeHttpEndpoints(first), { id: 'tickets', baseUrl: 'https://api.example.com/v1/', label: 'Tickets', auth: { type: 'none' } });
    expect(two).toHaveLength(2);
    expect(removeHttpEndpoint(serializeHttpEndpoints(two), 'tickets')).toHaveLength(1);
  });
  it('upserts by id before base URL so editing cannot merge into another endpoint', () => {
    const config = serializeHttpEndpoints(parseHttpEndpoints({ endpoints: [
      { id: 'a', baseUrl: 'https://a.example.com/', label: 'A' },
      { id: 'b', baseUrl: 'https://b.example.com/', label: 'B' },
    ] }));
    // Editing endpoint "a" onto b's base URL must update "a", not "b".
    const next = upsertHttpEndpoint(config, { id: 'a', baseUrl: 'https://b.example.com/', label: 'A2', auth: { type: 'none' } });
    expect(next.find((entry) => entry.id === 'a')).toMatchObject({ baseUrl: 'https://b.example.com/', label: 'A2' });
    expect(next.find((entry) => entry.id === 'b')).toMatchObject({ label: 'B' });
  });
});
