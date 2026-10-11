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

  it('reports wording cues as hints only, never as decisions', () => {
    expect(deriveJevRequestFeatures('담당자에게 보낼 메일 초안 써줘')).toMatchObject({ drafting_cue: true });
    expect(deriveJevRequestFeatures('메일 초안 써서 지금 보내줘')).not.toHaveProperty('drafting_cue');
    expect(deriveJevRequestFeatures('이 가구들의 총 재고 계산해줘')).toMatchObject({
      previous_context_reference_cue: true,
      calculation_or_summary_cue: true,
    });
    expect(deriveJevRequestFeatures('여기서 가격 높은 순으로 정렬해줘')).toMatchObject({ table_transform_cue: true });
    expect(deriveJevRequestFeatures('상품을 새로 조회해서 정렬해줘')).toMatchObject({ table_transform_cue: true, fresh_read_cue: true });
  });

});
