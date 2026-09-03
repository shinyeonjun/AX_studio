import { describe, expect, it } from 'vitest';
import { matchHttpEndpoint, parseHttpEndpoints } from '../connection.js';
describe('HTTP saved connection matching', () => {
  it('matches a saved connection by id, label, or base URL', () => {
    const endpoints = parseHttpEndpoints({ endpoints: [
      { id: 'default', baseUrl: 'https://api.github.com/', label: 'GitHub' },
      { id: 'tickets', baseUrl: 'https://api.example.com/v1/', label: 'Tickets' },
    ] });
    expect(matchHttpEndpoint(endpoints, 'tickets')?.id).toBe('tickets');
    expect(matchHttpEndpoint(endpoints, 'GitHub')?.id).toBe('default');
    expect(matchHttpEndpoint(endpoints)?.id).toBe('default');
  });
});
