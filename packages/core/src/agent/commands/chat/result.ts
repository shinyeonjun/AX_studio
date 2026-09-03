import type { AgentScopedContextMap } from '../../scoped-context.js';
import {
  AxUiPresentationSchema,
  type AxCommandResult,
  type AxUiPresentation,
} from '../schema.js';

export interface CommandChatSessionState {
  workflowId?: string;
  sessionMemo: AgentScopedContextMap;
  workflowPolicy: AgentScopedContextMap;
}

export function presentationFromResult(
  commandName: string,
  result: AxCommandResult,
): AxUiPresentation | undefined {
  if (commandName !== 'ui.present' && commandName !== 'job.propose' && commandName !== 'execution.enqueue_once') {
    return undefined;
  }
  if (commandName === 'ui.present' && result.status !== 'ok') return undefined;
  if (commandName === 'job.propose' && result.status !== 'ok' && result.status !== 'needs_input') return undefined;
  if (commandName === 'execution.enqueue_once' && result.status !== 'needs_input') return undefined;
  const presentationValue =
    result.data && typeof result.data === 'object' && !Array.isArray(result.data)
      ? (result.data as { presentation?: unknown }).presentation
      : undefined;
  const presentation = AxUiPresentationSchema.safeParse(presentationValue);
  return presentation.success ? presentation.data : undefined;
}

export function hostFacingMessage(result: AxCommandResult, fallback: string): string {
  if (result.data && typeof result.data === 'object' && !Array.isArray(result.data)) {
    const message = (result.data as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  const issues = result.issues.map((issue) => issue.message).filter(Boolean);
  if (issues.length > 0) return issues.join(' ');
  return fallback;
}

export function applyCommandResultToSession(
  commandName: string,
  result: AxCommandResult,
  session: CommandChatSessionState,
): void {
  if (result.status !== 'ok' || !result.data || typeof result.data !== 'object' || Array.isArray(result.data)) return;
  const data = result.data as { workflowId?: unknown; scope?: unknown; context?: unknown };
  if (commandName === 'workflow.create' || commandName === 'workflow.update' || commandName === 'job.commit') {
    if (typeof data.workflowId === 'string' && data.workflowId.trim()) session.workflowId = data.workflowId.trim();
  }
  if (commandName === 'workflow.delete' && data.workflowId === session.workflowId) {
    session.workflowId = undefined;
    session.workflowPolicy = {};
  }
  if (commandName === 'context.update' && data.context && typeof data.context === 'object' && !Array.isArray(data.context)) {
    if (data.scope === 'session') session.sessionMemo = data.context as AgentScopedContextMap;
    if (data.scope === 'workflow') session.workflowPolicy = data.context as AgentScopedContextMap;
  }
}
