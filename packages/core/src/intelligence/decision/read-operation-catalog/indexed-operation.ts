import type { HintMetadata, HintResolution } from './types.js';

const OPERATION_QUERY_STOP_WORDS = new Set([
  'api', 'http', 'rest', 'endpoint', 'json', 'database', 'db', 'sql', 'get', 'head',
  '조회', '검색', '읽기', '읽어', '가져', '가져와', '호출', '요청', '실행', '보여', '보여줘',
  '목록', '데이터', '자료', '정보', '테이블', '해줘', '해주세요', '부탁', '부탁해',
]);
const KOREAN_REQUEST_SUFFIX = /(?:해주세요|해줘|해봐|할래|할까|으로|에서|에게|부터|까지|을|를|이|가|은|는|에|로|와|과|도|만|의|랑|이나|나|해|줘)$/u;

export function operationQueryTokens(message: string): string[] {
  return [...message.toLocaleLowerCase().matchAll(/[\p{L}\p{N}][\p{L}\p{N}_-]*/gu)]
    .map(([token]) => token.replace(KOREAN_REQUEST_SUFFIX, ''))
    .filter((token) => token.length >= 2 && !/^\d+$/u.test(token) && !OPERATION_QUERY_STOP_WORDS.has(token));
}

function operationSearchTerms(text: string): string[] {
  const terms = new Set(operationQueryTokens(text));
  for (const [rawToken] of text.matchAll(/[A-Za-z][A-Za-z0-9_-]*/gu)) {
    for (const part of rawToken.split(/(?<=[a-z])(?=[A-Z])/u)) {
      const normalized = part.toLocaleLowerCase();
      if (normalized.length >= 2 && !OPERATION_QUERY_STOP_WORDS.has(normalized)) terms.add(normalized);
    }
  }
  return [...terms];
}

export interface IndexedReadOperation extends HintMetadata {
  key: string;
  searchTerms: readonly string[];
  resolve: (userMessage: string) => HintResolution | undefined;
}

export function addIndexedOperation(
  operations: IndexedReadOperation[],
  input: HintMetadata,
  resolve: (userMessage: string) => HintResolution | undefined,
): void {
  const searchText = [input.sourceLabel, input.label, input.description, input.capabilityId]
    .filter(Boolean)
    .join(' ');
  operations.push({
    ...input,
    key: `op_${operations.length}`,
    searchTerms: operationSearchTerms(searchText),
    resolve,
  });
}
