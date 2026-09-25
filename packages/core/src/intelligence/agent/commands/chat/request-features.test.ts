import { describe, expect, it } from 'vitest';
import { deriveJevRequestFeatures } from './request-features.js';

describe('deriveJevRequestFeatures', () => {
  it('passes number candidates without deciding which one is a result limit', () => {
    const features = deriveJevRequestFeatures('상품 5개 부탁해');

    expect(features).toEqual({ result_limit_candidates: [5] });
    expect(deriveJevRequestFeatures('재고 30개 미만 상품 5개')).toEqual({ result_limit_candidates: [30, 5] });
    expect(deriveJevRequestFeatures('API가 뭐야?')).toEqual({});
  });

  it('extracts an explicit HTTP method without classifying intent or execution timing', () => {
    expect(deriveJevRequestFeatures('GET /products 조회해줘')).toMatchObject({
      explicit_http_method: 'GET',
    });
    expect(deriveJevRequestFeatures('POST path: /orders 를 호출해줘').explicit_http_method).toBe('POST');
    expect(deriveJevRequestFeatures('OPTIONS /health 조회해줘').explicit_http_method).toBe('OPTIONS');
  });

});
