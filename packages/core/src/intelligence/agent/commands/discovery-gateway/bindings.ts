import type { AxCommand } from '../schema.js';
import type { DiscoveryCommandContext, DiscoveryCommandResult } from './contracts.js';
import { issue } from './shared.js';

const MAX_BINDINGS = 1_000;

/** Durable owner record so a chat keeps access to its discovery sessions after a restart. */
export interface DiscoverySessionOwnerStore {
  bindDiscoverySessionWorkspace(sessionId: string, workspaceSessionId: string): void;
  getDiscoverySessionWorkspace(sessionId: string): string | undefined;
}

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

  constructor(private readonly ownerStore?: DiscoverySessionOwnerStore) {}

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
      try {
        this.ownerStore?.bindDiscoverySessionWorkspace(sessionId, owner);
      } catch (error) {
        // The in-memory binding still protects this process; only restart survival is lost.
        console.warn('[discovery] could not persist the workspace binding', {
          code: (error as { code?: unknown } | null)?.code,
        });
      }
    }
    return result;
  }

  reject(command: AxCommand, context: DiscoveryCommandContext): DiscoveryCommandResult | undefined {
    const caller = callerSession(context);
    if (!caller) return undefined;
    const sessionId = requestedSessionId(command);
    // Argument validation stays with the handler so missing ids keep their input request.
    if (!sessionId) return undefined;
    if (this.ownerOf(sessionId) === caller) return undefined;
    return ['not_found', undefined, [issue('discovery_not_found', '진행 중인 업무 찾기를 찾지 못했어요. 처음부터 다시 요청해 주세요.')]];
  }

  private ownerOf(sessionId: string): string | undefined {
    const known = this.owners.get(sessionId);
    if (known !== undefined) return known;
    let stored: string | undefined;
    try {
      stored = this.ownerStore?.getDiscoverySessionWorkspace(sessionId);
    } catch {
      return undefined; // Fail closed: an unreadable owner never grants access.
    }
    return stored;
  }
}
