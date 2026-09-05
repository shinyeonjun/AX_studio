import type { ExecutionLogEntry } from '../../modules/types.js';
import {
  WorkspaceChatGeneratedPdfSchema,
  type WorkspaceChatGeneratedPdf,
} from '../../store/repositories/workspace-chat-repository.js';

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * Extract only safe PDF metadata from the host-generated execution log.
 * Stored paths, bytes, and arbitrary log fields never cross the chat boundary.
 */
export function generatedPdfFromExecutionLog(
  log: ReadonlyArray<ExecutionLogEntry>,
): WorkspaceChatGeneratedPdf | undefined {
  const entry = [...log].reverse().find((candidate) => candidate.code === 'pdf_generated');
  const parsed = WorkspaceChatGeneratedPdfSchema.safeParse(record(entry?.data));
  return parsed.success ? parsed.data : undefined;
}
