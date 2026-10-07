import { app } from 'electron';
import type { AxCore } from '../../core-instance.js';
import { runE2EChat } from '../../e2e-test-seam.js';
import { runE2EReportGeneration } from '../../e2e-test-seam/report.js';
import { e2EReportPhase } from '../../e2e-test-seam/gates.js';

/** Answers a turn with the E2E fake agent: a report phase when the message asks for one, else a fake chat. */
export async function runE2EChatTurn(core: AxCore, userMessage: string, workspaceSessionId: string, requestId: string) {
  const phase = e2EReportPhase(app.isPackaged, process.env, userMessage);
  const reply = phase
    ? await runE2EReportGeneration({ core, userMessage, workspaceSessionId }, phase)
    : await runE2EChat({ core, userMessage, workspaceSessionId });
  return {
    role: 'assistant' as const,
    content: reply.content,
    requestId,
    changedWorkflowIds: reply.changedWorkflowIds,
    removedWorkflowIds: reply.removedWorkflowIds,
    inputRequests: reply.inputRequests,
    presentations: reply.presentations,
  };
}
