import type { Connector } from '../../connectors/types.js';
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
    { query: 'in:inbox newer_than:7d', limit: 1 },
    {
      executionId: 'manual-run-enrich',
      workflowId: ir.id,
      variables: input,
      log: () => {},
    },
  );
  if (!result.ok) return input;
  const messages = Array.isArray(result.data) ? result.data
    : result.data && typeof result.data === 'object' && 'messages' in result.data
      && Array.isArray(result.data.messages) ? result.data.messages : [];
  const latest = messages.find((message): message is { id: string } =>
    Boolean(message) && typeof message === 'object' && typeof message.id === 'string' && Boolean(message.id.trim()));
  if (!latest?.id) return input;

  return {
    ...input,
    messageId: latest.id,
    sender: input.sender ?? input.from ?? '',
    subject: input.subject ?? '',
    snippet: input.snippet ?? '',
  };
}
