import { describe, expect, it } from 'vitest';
import {
  deriveJevRequestFeatures,
  hasJevPreflightEvidence,
  isExplicitOneShotExecutionRequest,
  isConceptualRequest,
} from './request-features.js';

describe('deriveJevRequestFeatures', () => {
  it('keeps exact numeric facts in code while exposing semantic scope evidence', () => {
    const features = deriveJevRequestFeatures('상품 5개 부탁해');

    expect(features).toMatchObject({
      data_reference: true,
      requested_limit: 5,
      requested_scope: 'collection',
      requested_timing: 'unknown',
    });
    expect(hasJevPreflightEvidence(features)).toBe(true);
  });

  it('distinguishes a direct action from a conceptual question', () => {
    const features = deriveJevRequestFeatures('API가 뭐야?');

    expect(features.data_reference).toBe(true);
    expect(features.direct_action).toBe(false);
    expect(isConceptualRequest('API가 뭐야?')).toBe(true);
  });

  it('extracts explicit HTTP method and immediate execution evidence', () => {
    expect(deriveJevRequestFeatures('GET /products 조회해줘')).toMatchObject({
      explicit_http_method: 'GET',
      direct_action: true,
      requested_timing: 'now',
    });
  });

  it('recognizes a direct one-shot execution without treating a preview as execution', () => {
    expect(isExplicitOneShotExecutionRequest(
      '상품 5개를 조회해서 재고 부족 상품만 정리하는 일회성 업무를 지금 실행해줘. 반복 업무로 저장하지는 마.',
    )).toBe(true);
    expect(isExplicitOneShotExecutionRequest(
      '일회성 업무를 실행하지 말고 계획만 보여줘.',
    )).toBe(false);
  });
});
