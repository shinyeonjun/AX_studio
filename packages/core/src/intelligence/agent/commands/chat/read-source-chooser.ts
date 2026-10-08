import type { SourceChoice } from '../../../../contracts/source-choices.js';
import type { JevReadOperationHint } from '../../../decision/read-operation-catalog.js';
import type { AxUiPresentation } from '../schema.js';

const CONNECTOR_NAMES: Record<string, string> = {
  rdb: '데이터베이스', http: 'API', openapi: 'API', gmail: 'Gmail', slack: 'Slack', local_folder: '폴더',
};
const MAX_CHOICES = 4;
export const SOURCE_CHOOSER_TITLE = '어디에서 찾을까요?';
const CHOICE_SUFFIX = '에서 찾기';
const MAX_ACTION_VALUE = 500;

/** A source as the person knows it: the connection's name, else what kind of connection it is. */
function sourceName(hint: JevReadOperationHint): string {
  return (hint.sourceLabel?.trim() || CONNECTOR_NAMES[hint.connector] || hint.connector).slice(0, 40);
}

/** One read as the person would name it: "회사 DB의 shop_orders", "주문 API의 주문 목록". */
function readName(hint: JevReadOperationHint): string {
  const source = sourceName(hint);
  let what = hint.label.replace(/^DB 조회:\s*/u, '').trim();
  if (what.startsWith(`${source}:`)) what = what.slice(source.length + 1).trim();
  return (what && what !== source ? `${source}의 ${what}` : source).slice(0, 60);
}

export function readSources(hints: readonly JevReadOperationHint[]): string[] {
  return [...new Set(hints.map(sourceName))];
}

/**
 * The request fits several reads and does not say which ("주문 목록": a shop table, a logistics
 * table, an order API): ask, with one button per place that resends the request naming it.
 * Places are sources when the reads come from different connections, or the reads themselves
 * when one connection has several that fit. At most four are offered, in the order given (most
 * relevant first); with more, the person is told they can name another.
 */
export function readSourceChooser(hints: readonly JevReadOperationHint[], request: string): { message: string; presentation: AxUiPresentation } | undefined {
  const sources = readSources(hints);
  const places = sources.length >= 2 ? sources : [...new Set(hints.map(readName))];
  if (places.length < 2) return undefined;
  const offered = places.slice(0, MAX_CHOICES);
  const more = places.length > offered.length;
  const actions = offered.map((place, index) => {
    const value = `${place}에서 ${request.trim()}`;
    return {
      id: `source_${index}`,
      label: `${place}${CHOICE_SUFFIX}`.slice(0, 80),
      value: value.length > MAX_ACTION_VALUE ? `${value.slice(0, MAX_ACTION_VALUE - 1)}…` : value,
      tone: index === 0 ? 'primary' as const : 'secondary' as const,
      purpose: 'reply' as const,
    };
  });
  const listed = offered.join(', ') + (more ? ` 등 ${places.length}곳` : '');
  const elsewhere = more ? ' 목록에 없는 곳이면 그 이름을 넣어 다시 말씀해 주세요.' : '';
  return {
    message: `${listed}에 모두 관련 자료가 있어 어느 쪽에서 찾을지 정하지 못했습니다. 한 곳을 골라 주세요.${elsewhere} 둘을 함께 비교하려면 "두 자료를 비교해 줘"처럼 말씀해 주세요. 아직 아무것도 실행하지 않았습니다.`,
    presentation: {
      title: SOURCE_CHOOSER_TITLE,
      subtitle: `${listed}에 모두 관련 자료가 있어요.`,
      inputMode: 'individual',
      blocks: [],
      inputs: [],
      actions,
    },
  };
}

type ChooserMessage = {
  role: string;
  presentations?: ReadonlyArray<{ title?: string; actions: ReadonlyArray<{ id: string; label: string; value: string }> }>;
};

/**
 * The place the person picked, when this message is a button of the source chooser shown just
 * before ("물류 DB에서 주문 목록 보여줘" → { request: "주문 목록 보여줘", place: "물류 DB" }).
 */
export function sourceChoiceFromReply(messages: readonly ChooserMessage[], userMessage: string): SourceChoice | undefined {
  const text = userMessage.trim();
  const previous = [...messages].reverse().find((message, index) => index > 0 || message.role !== 'user');
  if (previous?.role !== 'assistant') return undefined;
  for (const presentation of previous.presentations ?? []) {
    if (presentation.title !== SOURCE_CHOOSER_TITLE) continue;
    const action = presentation.actions.find((candidate) => candidate.id.startsWith('source_') && candidate.value === text);
    if (!action || !action.label.endsWith(CHOICE_SUFFIX)) continue;
    const place = action.label.slice(0, -CHOICE_SUFFIX.length);
    const prefix = `${place}에서 `;
    if (!text.startsWith(prefix)) continue;
    const request = text.slice(prefix.length).replace(/…$/u, '').trim();
    return request ? { request, place } : undefined;
  }
  return undefined;
}
