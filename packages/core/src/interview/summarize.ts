import type { WorkflowIR } from '../workflow/schema.js';
import { renderChatSummary } from './chat-summary.js';

export function summarizeWorkflow(ir: Partial<WorkflowIR>): string {
  return renderChatSummary(ir);
}
