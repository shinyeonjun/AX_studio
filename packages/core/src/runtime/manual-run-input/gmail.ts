import type { Connector } from '../../modules/types.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { workflowNeedsGmailMessageId } from './predicates.js';

/** Manual Gmail-trigger runs use the latest inbox message when no trigger payload exists. */
export async function enrichManualRunInput(
  ir: WorkflowIR,
  connectors: Record<string, Connector>,
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  if (!workflowNeedsGmailMessageId(ir)) return input;
  if (typeof input.messageId === 'string' && input.messageId.trim()) return input;

  const gmail = connectors.gmail;
  if (!gmail) return input;

  const result = await gmail.execute(
    'messages.search',
    { query: 'in:inbox newer_than:7d' },
    {
      executionId: 'manual-run-enrich',
      workflowId: ir.id,
      variables: input,
      log: () => {},
    },
  );
  if (!result.ok || !Array.isArray(result.data)) return input;

  const latest = (result.data as Array<{ id?: string }>).find((message) => typeof message.id === 'string');
  if (!latest?.id) return input;

  return {
    ...input,
    messageId: latest.id,
    sender: input.sender ?? input.from ?? '',
    subject: input.subject ?? '',
    snippet: input.snippet ?? '',
  };
}
