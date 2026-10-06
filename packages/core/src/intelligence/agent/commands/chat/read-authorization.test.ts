import { describe, expect, it } from 'vitest';
import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';
import type { AxCommand } from '../schema.js';
import { chatReadAuthorizationFor } from './read-authorization.js';

const productsHint: JevReadOperationHint = {
  key: 'op_0',
  capabilityId: 'http.request',
  connector: 'http',
  label: 'Products',
  description: 'GET products',
  params: { method: 'GET', path: 'products', connectionId: 'catalog' },
  parameterHints: [{ path: 'query.limit', type: 'integer', required: false, choices: [5] }],
};

const tableHint: JevReadOperationHint = {
  key: 'op_1',
  capabilityId: 'rdb.query.read',
  connector: 'rdb',
  label: 'DB 조회: orders',
  description: 'orders',
  params: { table: 'orders' },
  parameterHints: [{ path: 'limit', type: 'integer', required: false, choices: [10] }],
};

function invoke(id: string, params: Record<string, unknown>): AxCommand {
  return { name: 'capability.invoke', args: { id, params } } as AxCommand;
}

describe('chatReadAuthorizationFor', () => {
  it('authorizes a read compiled from a catalog hint plus declared parameters', () => {
    expect(chatReadAuthorizationFor(invoke('http.request', { method: 'GET', path: 'products?limit=5', connectionId: 'catalog' }), { hints: [productsHint] }))
      .toEqual({ capabilityId: 'http.request', params: { method: 'GET', path: 'products?limit=5', connectionId: 'catalog' } });
    expect(chatReadAuthorizationFor(invoke('rdb.query.read', { table: 'orders', limit: 10 }), { hints: [tableHint] }))
      .toBeDefined();
  });

  it('refuses paths, tables, connections, or parameters that no catalog hint declares', () => {
    expect(chatReadAuthorizationFor(invoke('http.request', { method: 'GET', path: 'products/category/x', connectionId: 'catalog' }), { hints: [productsHint] }))
      .toBeUndefined();
    expect(chatReadAuthorizationFor(invoke('http.request', { method: 'GET', path: 'products?select=secret', connectionId: 'catalog' }), { hints: [productsHint] }))
      .toBeUndefined();
    expect(chatReadAuthorizationFor(invoke('http.request', { method: 'GET', path: 'products', connectionId: 'other' }), { hints: [productsHint] }))
      .toBeUndefined();
    expect(chatReadAuthorizationFor(invoke('rdb.query.read', { table: 'users' }), { hints: [tableHint] })).toBeUndefined();
    expect(chatReadAuthorizationFor(invoke('rdb.query.read', { table: 'orders', where: 'x' }), { hints: [tableHint] })).toBeUndefined();
    expect(chatReadAuthorizationFor(invoke('http.request', { method: 'GET', path: 'products', connectionId: 'catalog' }), {}))
      .toBeUndefined();
  });

  it('authorizes an HTTP GET only for the path the user typed explicitly', () => {
    const command = invoke('http.request', { method: 'GET', path: 'orders?limit=2', connectionId: 'catalog' });
    expect(chatReadAuthorizationFor(command, { userText: 'GET orders?limit=2 조회해줘' })).toBeDefined();
    expect(chatReadAuthorizationFor(command, { userText: '주문 목록 보여줘' })).toBeUndefined();
    expect(chatReadAuthorizationFor(invoke('http.request', { method: 'POST', path: 'orders', connectionId: 'catalog' }), { userText: 'GET orders' }))
      .toBeUndefined();
  });

  it('never authorizes non-capability commands', () => {
    expect(chatReadAuthorizationFor({ name: 'workflow.list', args: {} } as AxCommand, { hints: [productsHint] })).toBeUndefined();
  });
});
