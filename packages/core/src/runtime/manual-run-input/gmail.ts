import type { Connector } from '../../connectors/types.js';
import { matchesTriggerFilter } from '../../triggers/filter.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { workflowNeedsGmailMessageId } from './predicates.js';

/** Messages scanned for a filtered trigger; an unfiltered run uses only the latest one. */
const FILTERED_SEARCH_LIMIT = 10;

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

/**
 * Manual Gmail-trigger runs use the latest inbox message when no trigger payload exists.
 * The payload mirrors a polled trigger event; fields the provider did not return stay
 * undefined instead of becoming empty strings, and the trigger filter is applied as a
 * real trigger run would.
 */
export async function enrichManualRunInput(
  ir: WorkflowIR,
  connectors: Record<string, Connector>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!workflowNeedsGmailMessageId(ir)) return input;
  if (typeof input.messageId === 'string' && input.messageId.trim()) return input;

  const gmail = connectors.gmail;
  if (!gmail) return input;

  const trigger = ir.trigger!;
  const result = await gmail.execute(
    'messages.search',
    { query: 'in:inbox newer_than:7d', limit: trigger.filter ? FILTERED_SEARCH_LIMIT : 1, includeMetadata: true },
    {
      executionId: 'manual-run-enrich',
      workflowId: ir.id,
      variables: input,
      log: () => {},
    },
  );
  if (!result.ok) return input;
  const messages: unknown[] = Array.isArray(result.data) ? result.data
    : result.data && typeof result.data === 'object' && 'messages' in result.data
      && Array.isArray(result.data.messages) ? result.data.messages : [];
  const candidates = messages
    .filter((message): message is Record<string, unknown> & { id: string } =>
      Boolean(message) && typeof message === 'object'
      && typeof (message as { id?: unknown }).id === 'string' && Boolean((message as { id: string }).id.trim()))
    .map((message) => {
      const from = nonEmptyString(message.from) ?? nonEmptyString(input.sender) ?? nonEmptyString(input.from);
      const payload: Record<string, unknown> = { messageId: message.id };
      if (from !== undefined) { payload.from = from; payload.sender = from; }
      const subject = nonEmptyString(message.subject) ?? nonEmptyString(input.subject);
      if (subject !== undefined) payload.subject = subject;
      const snippet = nonEmptyString(message.snippet) ?? nonEmptyString(input.snippet);
      if (snippet !== undefined) payload.snippet = snippet;
      return payload;
    });
  if (candidates.length === 0) return input;

  const match = candidates.find((payload) => matchesTriggerFilter(trigger, { type: trigger.type, payload }));
  if (!match) {
    throw Object.assign(
      new Error('최근 받은편지함 메일 중 트리거 조건에 맞는 메일이 없습니다. 조건에 맞는 메일이 도착한 뒤 다시 실행해 주세요.'),
      { code: 'manual_run_filter_no_match' },
    );
  }
  return { ...input, ...match };
}
