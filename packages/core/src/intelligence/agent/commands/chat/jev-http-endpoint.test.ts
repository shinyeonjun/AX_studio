import { describe, expect, it } from 'vitest';
import { explicitHttpPath, selectHttpEndpointForRead } from './jev-http-endpoint.js';

describe('explicitHttpPath', () => {
  it('separates a Korean object particle attached to a query value', () => {
    expect(explicitHttpPath('GET products?limit=2를 조회하고 표로 보여줘.'))
      .toBe('products?limit=2');
  });

  it('rejects absolute URLs and protocol-relative paths', () => {
    expect(explicitHttpPath('GET https://example.test/products')).toBeUndefined();
    expect(explicitHttpPath('GET //example.test/products')).toBeUndefined();
  });
});

describe('selectHttpEndpointForRead', () => {
  const endpoints = [
    { id: 'inventory', label: 'Inventory API' },
    { id: 'orders', label: 'Orders API' },
  ] as const;

  it('selects an exactly named usable endpoint', () => {
    expect(selectHttpEndpointForRead('Inventory API에서 GET products', endpoints)?.id).toBe('inventory');
  });

  it('does not choose arbitrarily when a request names no endpoint among several', () => {
    expect(selectHttpEndpointForRead('GET products', endpoints)).toBeUndefined();
  });

  it('does not choose a different endpoint when an explicit name is unknown', () => {
    expect(selectHttpEndpointForRead('Billing API GET invoices', endpoints)).toBeUndefined();
  });

  it('fails closed when the request names more than one usable endpoint', () => {
    expect(selectHttpEndpointForRead('Inventory API and Orders API GET products', endpoints)).toBeUndefined();
  });

  it('does not select an endpoint explicitly named by the user when that endpoint is unusable', () => {
    expect(selectHttpEndpointForRead('Inventory API GET products', [
      { id: 'inventory', label: 'Inventory API', usable: false },
      endpoints[1],
    ])).toBeUndefined();
  });

  it('uses the only usable endpoint when the request does not name one', () => {
    expect(selectHttpEndpointForRead('GET products', [endpoints[0], { ...endpoints[1], usable: false }])?.id)
      .toBe('inventory');
  });
});
