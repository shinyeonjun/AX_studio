import { describe, expect, it } from 'vitest';
import { compileHttpReadCommand, compileReadParameterCommand } from './read-plan.js';

const plan = {
  capabilityId: 'openapi.orders.getOrder',
  fixedParams: { query: { limit: 10 } },
  allowedParameterPaths: ['pathParams.orderId', 'query.limit'],
  requiredParameterPaths: ['pathParams.orderId'],
} as const;

describe('compileReadParameterCommand', () => {
  it('merges one allowed value while preserving host-owned fixed params', () => {
    expect(compileReadParameterCommand({
      name: 'capability.invoke',
      args: {
        id: 'openapi.orders.getOrder',
        params: { pathParams: { orderId: 'order-7' }, query: { limit: 10 } },
      },
    }, plan)).toEqual({
      ok: true,
      command: {
        name: 'capability.invoke',
        args: {
          id: 'openapi.orders.getOrder',
          params: { query: { limit: 10 }, pathParams: { orderId: 'order-7' } },
        },
      },
    });
  });

  it('rejects a different capability or an undeclared parameter', () => {
    expect(compileReadParameterCommand({
      name: 'capability.invoke',
      args: { id: 'http.request', params: { path: '/orders' } },
    }, plan)).toMatchObject({ ok: false, error: 'read_capability_mismatch' });

    expect(compileReadParameterCommand({
      name: 'capability.invoke',
      args: {
        id: 'openapi.orders.getOrder',
        params: { pathParams: { orderId: 'order-7' }, headers: { authorization: 'secret' } },
      },
    }, plan)).toMatchObject({ ok: false, error: 'read_parameters_invalid' });
  });

  it('reports missing required values without executing the connector', () => {
    expect(compileReadParameterCommand({
      name: 'capability.invoke',
      args: { id: 'openapi.orders.getOrder', params: { query: { limit: 10 } } },
    }, plan)).toEqual({
      ok: false,
      error: 'read_parameters_missing',
      missing: ['pathParams.orderId'],
    });
  });
});

describe('compileHttpReadCommand', () => {
  it('keeps a schema-less planner inside one connection and read method', () => {
    expect(compileHttpReadCommand({
      name: 'capability.invoke',
      args: {
        id: 'http.request',
        params: {
          method: 'get', path: 'products?limit=5', connectionId: 'dummyjson',
          headers: { 'x-ignored': 'value' },
        },
      },
    }, { connectionId: 'dummyjson' })).toEqual({
      ok: true,
      command: {
        name: 'capability.invoke',
        args: {
          id: 'http.request',
          params: { method: 'GET', path: 'products?limit=5', connectionId: 'dummyjson' },
        },
      },
    });
  });

  it('rejects an absolute URL or a capability swap', () => {
    expect(compileHttpReadCommand({
      name: 'capability.invoke',
      args: { id: 'http.request', params: { path: 'https://evil.test', connectionId: 'dummyjson' } },
    }, { connectionId: 'dummyjson' })).toMatchObject({ ok: false, error: 'http_read_parameters_invalid' });
    expect(compileHttpReadCommand({
      name: 'capability.invoke',
      args: { id: 'rdb.query.read', params: { table: 'orders' } },
    }, { connectionId: 'dummyjson' })).toMatchObject({ ok: false, error: 'http_read_capability_mismatch' });
  });
});
