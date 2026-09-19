import { describe, expect, it } from 'vitest';
import {
  deriveJevRequestFeatures,
  hasJevPreflightEvidence,
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
});
