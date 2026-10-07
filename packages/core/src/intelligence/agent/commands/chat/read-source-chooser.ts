import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';
import type { AxUiPresentation } from '../schema.js';

const CONNECTOR_NAMES: Record<string, string> = {
  rdb: '데이터베이스', http: 'API', openapi: 'API', gmail: 'Gmail', slack: 'Slack', local_folder: '폴더',
};
const MAX_SOURCES = 4;
const MAX_ACTION_VALUE = 500;

/** A source as the person knows it: the connection's name, else what kind of connection it is. */
function sourceName(hint: JevReadOperationHint): string {
  return (hint.sourceLabel?.trim() || CONNECTOR_NAMES[hint.connector] || hint.connector).slice(0, 40);
}

export function readSources(hints: readonly JevReadOperationHint[]): string[] {
  return [...new Set(hints.map(sourceName))];
}

/**
 * Two connections both hold what the request asks about ("화장품": a shop DB and a product API),
 * and no single read answers it: ask which one, with buttons that resend the request naming it.
 */
export function readSourceChooser(hints: readonly JevReadOperationHint[], request: string): { message: string; presentation: AxUiPresentation } | undefined {
  const sources = readSources(hints);
  if (sources.length < 2 || sources.length > MAX_SOURCES) return undefined;
  const actions = sources.map((source, index) => {
    const value = `${source}에서 ${request.trim()}`;
    return {
      id: `source_${index}`,
      label: `${source}에서 찾기`.slice(0, 80),
      value: value.length > MAX_ACTION_VALUE ? `${value.slice(0, MAX_ACTION_VALUE - 1)}…` : value,
      tone: index === 0 ? 'primary' as const : 'secondary' as const,
      purpose: 'reply' as const,
    };
  });
  const listed = sources.join(', ');
  return {
    message: `${listed}에 모두 관련 자료가 있어 어느 쪽에서 찾을지 정하지 못했어요. 한 곳을 골라 주세요. 둘을 함께 비교하려면 "두 자료를 비교해 줘"처럼 말씀해 주세요. 아직 아무것도 실행하지 않았습니다.`,
    presentation: {
      title: '어디에서 찾을까요?',
      subtitle: `${listed}에 모두 관련 자료가 있어요.`,
      inputMode: 'individual',
      blocks: [],
      inputs: [],
      actions,
    },
  };
}
