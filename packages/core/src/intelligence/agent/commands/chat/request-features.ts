import { requestLimitCandidates } from '../../../decision/request-limit.js';

export interface JevRequestFeatures {
  explicit_http_method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
  result_limit_candidates?: number[];
}

const HTTP_METHOD_HINT = /\b(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/iu;

export function deriveJevRequestFeatures(message: string): JevRequestFeatures {
  const normalized = message.trim();
  const resultLimitCandidates = requestLimitCandidates(normalized);
  const explicitHttpMethod = normalized.match(HTTP_METHOD_HINT)?.[1]?.toUpperCase() as JevRequestFeatures['explicit_http_method'];

  return {
    ...(explicitHttpMethod ? { explicit_http_method: explicitHttpMethod } : {}),
    ...(resultLimitCandidates.length > 0 ? { result_limit_candidates: resultLimitCandidates } : {}),
  };
}
