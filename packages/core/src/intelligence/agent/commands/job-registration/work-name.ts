import type { AgentHarness } from '../../harness.js';
import { appendAppLog } from '../../../../persistence/paths/app-log.js';

const MAX_WORK_NAME_CHARS = 40;

/**
 * A work's name from the request that made it, without the request's ask: "Gmail 새 메일이 오면
 * 요약해서 #ops로 알려주는 반복 업무를 만들어줘" -> "Gmail 새 메일이 오면 요약해서 #ops로 알려주는 업무".
 */
export function workNameFromRequest(request: string, fallback: string): string {
  let name = request.trim().replace(/[.!?。]+$/u, '').trim();
  // "...반복 업무를 만들어줘", "...작업 등록해 주세요": the ask, not the work.
  name = name.replace(/\s*(?:반복\s*)?(?:업무|작업|워크플로우|자동화)?\s*(?:을|를)?\s*(?:만들어|등록해|생성해|설정해|추가해)\s*(?:줘|주세요|줄래|주라)$/u, '').trim();
  // A clause that now ends in a modifier ("알려주는") names the work it modifies.
  if (/[는은던]$/u.test(name)) name = `${name} 업무`;
  if (!name) return fallback;
  return name.length > MAX_WORK_NAME_CHARS ? `${name.slice(0, MAX_WORK_NAME_CHARS - 1)}…` : name;
}

const NAME_TIMEOUT_MS = 15_000;
const NAME_PROMPT = [
  '반복 업무의 이름을 짓는다. 입력은 사람이 한 요청 한 문장이다.',
  '- 출력: 이름 하나만. 2~20자 한국어 명사구. 따옴표·마침표·설명 금지.',
  '- 무엇을 하는 업무인지가 드러나게. 예: "반품된 주문만 보여줘" → 반품 주문 확인, "재고 10개 미만 상품 알려줘" → 재고 부족 상품 확인.',
].join('\n');

/**
 * A short name for a recurring job, asked once of the person's AI ("반품된 주문만 보여줘" →
 * "반품 주문 확인"). Only the request is sent. Undefined when it fails or answers something that is
 * not a short single-line name; the caller then names the job from the request itself.
 */
export async function suggestWorkName(
  harness: Pick<AgentHarness, 'runText'>,
  request: string,
  options: { requestId?: string; signal?: AbortSignal } = {},
): Promise<string | undefined> {
  const text = request.trim();
  if (!text) return undefined;
  try {
    const timeout = AbortSignal.timeout(NAME_TIMEOUT_MS);
    const reply = await harness.runText({
      requestId: options.requestId ? `${options.requestId}:work-name` : undefined,
      role: 'command',
      systemPrompt: NAME_PROMPT,
      messages: [{ role: 'user', content: text.slice(0, 500) }],
      logContext: 'work_name',
      codexReasoningEffort: 'low',
      abortSignal: options.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
    });
    const name = reply.output.trim().replace(/^["'“”「」]+|["'“”「」.。]+$/gu, '').trim();
    return name.length >= 2 && name.length <= 30 && !/[\r\n]/u.test(name) ? name : undefined;
  } catch (error) {
    options.signal?.throwIfAborted();
    appendAppLog('warn', 'Work name suggestion failed; named from the request.', {
      requestId: options.requestId, event: 'work_name', code: (error as { code?: unknown } | null)?.code,
    });
    return undefined;
  }
}
