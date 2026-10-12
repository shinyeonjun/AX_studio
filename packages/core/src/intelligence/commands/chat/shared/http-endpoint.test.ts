import { describe, expect, it } from 'vitest';
import { explicitHttpPath, requestMentionsHttp, selectHttpEndpointForRead } from './http-endpoint.js';

describe('explicitHttpPath', () => {
  it('separates a Korean object particle attached to a query value', () => {
    expect(explicitHttpPath('GET products?limit=2를 조회하고 표로 보여줘.'))
      .toBe('products?limit=2');
  });

  it('requires an explicit cue before treating slash-separated text as a path', () => {
    expect(explicitHttpPath('I/O 성능 요약해줘')).toBeUndefined();
    expect(explicitHttpPath('A/B 테스트 결과 알려줘')).toBeUndefined();
    expect(explicitHttpPath('상품/재고 현황 정리해줘')).toBeUndefined();
    expect(explicitHttpPath('products/category 보여줘')).toBeUndefined();
    expect(explicitHttpPath('API에서 products/category 보여줘')).toBe('products/category');
    expect(explicitHttpPath('DummyJSON에서 /products/search?q=phone 조회')).toBe('/products/search?q=phone');
    expect(explicitHttpPath('경로: products/1')).toBe('products/1');
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

describe('requestMentionsHttp', () => {
  const endpoints = [{ id: 'acme-ops', label: 'Acme Operations' }];

  it.each([
    ['#ax테스트에 안녕하세요 보내줘', false],
    ['메일로 보고서 보내줘', false],
    ['Acme Operations에 결제 등록해줘', true],
    ['결제 API로 주문 보내줘', true],
    ['https://example.invalid/hook 로 POST 해줘', true],
    ['웹훅으로 알려줘', true],
  ])('%s -> %s', (message, expected) => {
    expect(requestMentionsHttp(message, endpoints)).toBe(expected);
  });

  // Real use: one of the person's HTTP connections is called "테스트".
  const realEndpoints = [{ id: 'default', label: '깃허브' }, { id: 'test-id', label: '테스트' }];

  it.each([
    ["ax테스트 채널에 'AX Studio 실사용 테스트 메시지입니다' 라고 보내줘", false],
    ['#ax테스트에 테스트 메시지 보내줘', false],
    ['me@example.invalid로 테스트 결과 보내줘', false],
    ['테스트에 주문 등록해줘', true],
    ['깃허브로 이슈 올려줘', true],
  ])('with an endpoint named like a common word: %s -> %s', (message, expected) => {
    expect(requestMentionsHttp(message, realEndpoints)).toBe(expected);
  });
});
