import { describe, expect, it } from 'vitest';
import { extractHttpReadOperations } from './discovery.js';

describe('HTTP read operation discovery', () => {
  it('extracts same-origin collection links from a service landing page', () => {
    const operations = extractHttpReadOperations(
      'https://dummyjson.com/',
      'text/html; charset=utf-8',
      '<a href="https://dummyjson.com/products" target="_blank">Products</a>'
        + '<a href="/carts?limit=5" target="_blank">Carts &amp; Orders</a>'
        + '<a href="/docs/products">Documentation</a>'
        + '<a href="https://other.example/products">External</a>'
        + '<a href="/public/app.js">Script</a>',
    );

    expect(operations).toEqual([
      { path: 'products', label: 'Products' },
      { path: 'carts', label: 'Carts & Orders' },
    ]);
  });

  it('keeps discovered links under the configured base path', () => {
    expect(extractHttpReadOperations(
      'https://api.example.test/v1/',
      'text/html',
      '<a href="/v1/orders" target="_blank">Orders</a><a href="/admin/users" target="_blank">Users</a>',
    )).toEqual([{ path: 'orders', label: 'Orders' }]);
  });

  it('extracts hypermedia links from JSON without treating ordinary data URLs as operations', () => {
    expect(extractHttpReadOperations(
      'https://api.example.test/',
      'application/json',
      JSON.stringify({
        _links: {
          products: { href: '/products', title: 'Products' },
          self: { href: '/' },
        },
        avatar: 'https://api.example.test/images/avatar.png',
      }),
    )).toEqual([{ path: 'products', label: 'Products' }]);
  });
});
