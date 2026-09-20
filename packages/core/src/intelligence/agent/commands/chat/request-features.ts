export type JevRequestScope = 'single' | 'collection' | 'unknown';
export type JevRequestTiming = 'now' | 'repeat' | 'plan' | 'unknown';

export interface JevRequestFeatures {
  data_reference: boolean;
  direct_action: boolean;
  explicit_http_method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  requested_limit?: number;
  requested_scope: JevRequestScope;
  requested_timing: JevRequestTiming;
}

const ACTION_HINT = /조회|검색|읽|가져|호출|요청|실행|돌려|시작|만들|생성|저장|예약|반복|등록|발송|전송|삭제|수정|변경|연결|보여|목록|확인|정리|추천|분석|\b(?:run|execute|get|post|delete|show|list|call)\b/iu;
const DIRECT_ACTION_HINT = /(?:조회|검색|읽|가져|호출|요청|실행|돌려|시작|만들|생성|저장|예약|반복|등록|발송|전송|삭제|수정|변경|연결|보여|확인|정리|추천|분석)(?:해|하|할|하고|해서|해줘|해주세요|해봐|해볼|할래|할까|줘|주세요|어줘|어주세요)/iu;
const DATA_REFERENCE_HINT = /(?:api|http|rest|endpoint|json|database|\bdb\b|sql|table|row|item|product|order|customer|상품|제품|주문|고객|데이터|자료|정보|테이블|문서|파일|연결)/iu;
const COLLECTION_HINT = /(?:목록|리스트|전체|여러|상품들|제품들|행들|건들|\ball\b|\blist\b|\bitems?\b|\brows?\b|\bmany\b)/iu;
const SINGLE_HINT = /(?:단건|단일|하나|한\s*(?:개|건|행)|상세|특정|\bone\b|\bsingle\b|\bdetail\b)/iu;
const REPEAT_HINT = /(?:반복|주기|매일|매주|매월|예약|스케줄|schedule|recurr)/iu;
const PLAN_HINT = /(?:계획|설계|검토|초안|제안|plan|design|draft)/iu;
const ONE_SHOT_HINT = /(?:일회성|한\s*번만|이번만|반복\s*(?:업무|작업|workflow)?\s*(?:로\s*)?(?:저장|등록|활성화)하지|저장하지\s*(?:마|말고))/iu;
const NEGATIVE_EXECUTION_HINT = /(?:실행하지|실행\s*말고|돌리지\s*말고|검토만|계획만|dry\s*run|do\s*not\s*run|don't\s*run)/iu;
const HTTP_METHOD_HINT = /\b(GET|HEAD|POST|PUT|PATCH|DELETE)\b/iu;
const LIMIT_HINT = /(?:^|\s)(\d{1,4})\s*(?:개만|개|건|행|items?|rows?|results?)(?:\s|$)/iu;

export function requestLimitValue(message: string): number | undefined {
  const match = message.match(LIMIT_HINT);
  if (!match) return undefined;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export function hasRequestActionHint(message: string): boolean {
  return ACTION_HINT.test(message);
}

export function hasDirectActionHint(message: string): boolean {
  return DIRECT_ACTION_HINT.test(message);
}

export function isExplicitOneShotExecutionRequest(message: string): boolean {
  return ONE_SHOT_HINT.test(message) && !NEGATIVE_EXECUTION_HINT.test(message) && hasDirectActionHint(message);
}

export function isConceptualRequest(message: string): boolean {
  return /(?:뭐\s*(?:야|냐)|무엇|차이|뜻|의미|왜\s|어떻게\s)/iu.test(message);
}

export function deriveJevRequestFeatures(message: string): JevRequestFeatures {
  const normalized = message.trim();
  const requestedLimit = requestLimitValue(normalized);
  const explicitHttpMethod = normalized.match(HTTP_METHOD_HINT)?.[1]?.toUpperCase() as JevRequestFeatures['explicit_http_method'];
  const requestedScope: JevRequestScope = requestedLimit === 1 || SINGLE_HINT.test(normalized)
    ? 'single'
    : requestedLimit !== undefined || COLLECTION_HINT.test(normalized)
      ? 'collection'
      : 'unknown';
  const requestedTiming: JevRequestTiming = REPEAT_HINT.test(normalized)
    ? 'repeat'
    : PLAN_HINT.test(normalized)
      ? 'plan'
      : hasDirectActionHint(normalized)
        ? 'now'
        : 'unknown';

  return {
    data_reference: DATA_REFERENCE_HINT.test(normalized) || requestedLimit !== undefined,
    direct_action: hasDirectActionHint(normalized),
    ...(explicitHttpMethod ? { explicit_http_method: explicitHttpMethod } : {}),
    ...(requestedLimit === undefined ? {} : { requested_limit: requestedLimit }),
    requested_scope: requestedScope,
    requested_timing: requestedTiming,
  };
}

/**
 * This is only a cheap preflight signal. Jev remains the semantic authority;
 * callers must not treat these lexical facts as the final route decision.
 */
export function hasJevPreflightEvidence(features: JevRequestFeatures): boolean {
  return features.data_reference || features.direct_action || features.explicit_http_method !== undefined;
}
