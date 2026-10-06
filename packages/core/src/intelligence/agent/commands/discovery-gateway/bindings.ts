import type { AxCommand } from '../schema.js';
import type { DiscoveryCommandContext, DiscoveryCommandResult } from './contracts.js';
import { issue } from './shared.js';

const MAX_BINDINGS = 1_000;

function requestedSessionId(command: AxCommand): string | undefined {
  const value = command.args && typeof command.args === 'object'
    ? (command.args as { sessionId?: unknown }).sessionId
    : undefined;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function callerSession(context: DiscoveryCommandContext): string | undefined {
  return context.workspaceSessionId?.trim() || undefined;
}

/**
 * Host-side map from a discovery session to the workspace chat session that started it.
 *
 * A caller that identifies a workspace session (every chat turn does) may only touch the
 * discovery sessions that session started. Unknown, unbound and foreign ids all return the
 * same not-found result so a chat cannot probe other sessions. Callers without a workspace
 * session (the dedicated discovery UI) keep their existing behavior.
 */
export class DiscoverySessionBindings {
  private readonly owners = new Map<string, string>();

  record(result: DiscoveryCommandResult, context: DiscoveryCommandContext): DiscoveryCommandResult {
    const owner = callerSession(context);
    const data = result[1];
    const sessionId = result[0] === 'ok' && data && typeof data === 'object'
      ? (data as { sessionId?: unknown }).sessionId
      : undefined;
    if (owner && typeof sessionId === 'string') {
      if (this.owners.size >= MAX_BINDINGS) {
        const oldest = this.owners.keys().next().value;
        if (oldest !== undefined) this.owners.delete(oldest);
      }
      this.owners.set(sessionId, owner);
    }
    return result;
  }

  reject(command: AxCommand, context: DiscoveryCommandContext): DiscoveryCommandResult | undefined {
    const caller = callerSession(context);
    if (!caller) return undefined;
    const sessionId = requestedSessionId(command);
    // Argument validation stays with the handler so missing ids keep their input request.
    if (!sessionId) return undefined;
    if (this.owners.get(sessionId) === caller) return undefined;
    return ['not_found', undefined, [issue('discovery_not_found', 'discovery session을 찾을 수 없습니다.')]];
  }
}
