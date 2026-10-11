import { requestLimitCandidates } from '../../../decision/request-limit.js';

/**
 * Lexical request cues sent to Jev as untrusted hints. They describe wording only;
 * the host uses them at most as tie-breakers and never to override a confident route.
 */
export interface JevRequestFeatures {
  explicit_http_method?: 'GET' | 'HEAD' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'OPTIONS';
  result_limit_candidates?: number[];
  /** Wording asks to write/draft text without wording that asks to send it. */
  drafting_cue?: true;
  /** Wording refers back to an earlier result ("이 중", "방금 결과"). */
  previous_context_reference_cue?: true;
  /** Wording asks to calculate, summarize, or explain. */
  calculation_or_summary_cue?: true;
  /** Wording asks to sort, filter, or export a table. */
  table_transform_cue?: true;
  /** Wording explicitly asks for a fresh read. */
  fresh_read_cue?: true;
}

const HTTP_METHOD_HINT = /\b(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS)\b/iu;
const DRAFTING_CUE = /(?:써\s*줘|써\s*봐|작성해\s*줘|초안|내용\s*만들어\s*줘|답장\s*써)/iu;
const SEND_CUE = /(?:보내\s*줘|발송해\s*줘|전송해\s*줘|지금\s*보내|큐에\s*등록|전송\s*실행|게시해\s*줘)/iu;
const PREVIOUS_CONTEXT_CUE = /(?:(?:^|\s)(?:이|그|방금|앞의|위의)\s*(?:가구|상품|제품|데이터|자료|표|목록|결과|것|애들|들)|여기서|이\s*중|그\s*중|방금\s*결과)/u;
const CALCULATION_OR_SUMMARY_CUE = /(?:계산|합계|총|평균|몇\s*개|얼마|요약|설명|분석|정리)/u;
const TABLE_TRANSFORM_CUE = /(?:정렬|순으로|높은\s*순|낮은\s*순|많은\s*순|적은\s*순|필터|남겨\s*줘|추려\s*줘|제외해\s*줘|빼\s*줘|엑셀|xlsx)/iu;
const FRESH_READ_CUE = /(?:새로\s*조회|다시\s*조회|새로\s*가져와|새로\s*불러와|다시\s*가져와)/u;

export function deriveJevRequestFeatures(message: string): JevRequestFeatures {
  const normalized = message.trim();
  const resultLimitCandidates = requestLimitCandidates(normalized);
  const explicitHttpMethod = normalized.match(HTTP_METHOD_HINT)?.[1]?.toUpperCase() as JevRequestFeatures['explicit_http_method'];

  return {
    ...(explicitHttpMethod ? { explicit_http_method: explicitHttpMethod } : {}),
    ...(resultLimitCandidates.length > 0 ? { result_limit_candidates: resultLimitCandidates } : {}),
    ...(DRAFTING_CUE.test(normalized) && !SEND_CUE.test(normalized) ? { drafting_cue: true as const } : {}),
    ...(PREVIOUS_CONTEXT_CUE.test(normalized) ? { previous_context_reference_cue: true as const } : {}),
    ...(CALCULATION_OR_SUMMARY_CUE.test(normalized) ? { calculation_or_summary_cue: true as const } : {}),
    ...(TABLE_TRANSFORM_CUE.test(normalized) ? { table_transform_cue: true as const } : {}),
    ...(FRESH_READ_CUE.test(normalized) ? { fresh_read_cue: true as const } : {}),
  };
}
