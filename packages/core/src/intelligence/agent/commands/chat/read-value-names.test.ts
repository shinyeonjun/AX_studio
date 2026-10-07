import { describe, expect, it } from 'vitest';
import { readValueNames } from './read-value-names.js';

describe('missing read values named for people', () => {
  it('says common values in Korean, quotes the rest, and names each once', () => {
    expect(readValueNames(['query.q', 'query.limit', 'params.connectionId'])).toBe('검색어, 가져올 개수, 연결');
    expect(readValueNames(['pathParams.orderId', 'query.per_page', 'query.size'])).toBe("'orderId', 가져올 개수");
  });
});
