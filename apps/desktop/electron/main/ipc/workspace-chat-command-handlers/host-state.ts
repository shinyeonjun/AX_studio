import { randomUUID } from 'node:crypto';
import type { AxContextUpdateConfirmation, AxUiPresentation, ChatReadRecipe, TableArtifact, WorkspaceChatMessage } from '@ax-studio/core';

/**
 * Host-only per-session state that the renderer-saved transcript cannot forge.
 * Process-local: an app restart drops pending confirmations and the cached table,
 * so the user re-confirms or re-reads instead of trusting a stale transcript.
 */

export const CONTEXT_CONFIRMATION_PREFIX = 'confirm_context:';
const CONTEXT_CONFIRMATION_TTL_MS = 30 * 60_000;
const MAX_CONFIRMATIONS_PER_SESSION = 16;
const MAX_SESSIONS = 256;

interface PendingContextConfirmation {
  contextUpdate: AxContextUpdateConfirmation;
  createdAt: number;
}

const contextConfirmations = new Map<string, Map<string, PendingContextConfirmation>>();
const readResults = new Map<string, TableArtifact>();
/** How the cached table was produced; kept only alongside that table. */
const readRecipes = new Map<string, ChatReadRecipe>();

function touchSession<T>(store: Map<string, T>, sessionId: string, value: T): void {
  store.delete(sessionId);
  store.set(sessionId, value);
  while (store.size > MAX_SESSIONS) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

/**
 * Bind every confirm_context action to a host nonce and keep the exact core-produced
 * proposal host-side. The transcript copy of `contextUpdate` stays for display only.
 */
export function bindContextConfirmations(
  sessionId: string,
  presentations: AxUiPresentation[],
  now = Date.now(),
): AxUiPresentation[] {
  return presentations.map((presentation) => ({
    ...presentation,
    actions: presentation.actions.map((action) => {
      if (action.purpose !== 'confirm_context' || !action.contextUpdate) return action;
      const nonce = randomUUID();
      const pending = contextConfirmations.get(sessionId) ?? new Map<string, PendingContextConfirmation>();
      pending.set(nonce, { contextUpdate: structuredClone(action.contextUpdate), createdAt: now });
      while (pending.size > MAX_CONFIRMATIONS_PER_SESSION) {
        const oldest = pending.keys().next().value;
        if (oldest === undefined) break;
        pending.delete(oldest);
      }
      touchSession(contextConfirmations, sessionId, pending);
      return { ...action, id: `${CONTEXT_CONFIRMATION_PREFIX}${nonce}` };
    }),
  }));
}

/** Non-consuming: the nonce of the confirm_context action whose value is this user message. */
export function findContextConfirmationNonce(
  messages: WorkspaceChatMessage[],
  userMessage: string,
): string | undefined {
  for (const message of messages.slice(0, -1).reverse()) {
    if (message.role !== 'assistant') continue;
    for (const presentation of [...(message.presentations ?? [])].reverse()) {
      for (const action of [...presentation.actions].reverse()) {
        if (action.purpose !== 'confirm_context' || action.value !== userMessage) continue;
        if (!action.id.startsWith(CONTEXT_CONFIRMATION_PREFIX)) continue;
        const nonce = action.id.slice(CONTEXT_CONFIRMATION_PREFIX.length).trim();
        if (nonce) return nonce;
      }
    }
  }
  return undefined;
}

/** One-shot: returns the host-stored proposal and forgets it; unknown or expired nonces fail closed. */
export function consumeContextConfirmation(
  sessionId: string,
  nonce: string,
  now = Date.now(),
): AxContextUpdateConfirmation | undefined {
  const pending = contextConfirmations.get(sessionId);
  const entry = pending?.get(nonce);
  if (!pending || !entry) return undefined;
  pending.delete(nonce);
  if (pending.size === 0) contextConfirmations.delete(sessionId);
  if (now - entry.createdAt > CONTEXT_CONFIRMATION_TTL_MS) return undefined;
  return entry.contextUpdate;
}

/** Remember the bounded table the host itself displayed for this session. */
/**
 * Holds the table this turn shows and returns it under an id of its own. Reads name their tables
 * by kind ("chat:capability-result"), so without this a newer table the screen never got (a reply
 * the window dropped) would pass for the older one still on screen, and "이 중 …" would work on
 * rows the person never saw.
 */
export function rememberHostReadResult<T extends TableArtifact | undefined>(sessionId: string, table: T, recipe?: ChatReadRecipe): T {
  if (!table) {
    readResults.delete(sessionId);
    readRecipes.delete(sessionId);
    return table;
  }
  const shown = { ...structuredClone(table), id: `${table.id.split('#', 1)[0]}#${randomUUID()}` } as T & TableArtifact;
  touchSession(readResults, sessionId, structuredClone(shown));
  if (recipe) touchSession(readRecipes, sessionId, structuredClone(recipe));
  else readRecipes.delete(sessionId);
  return shown;
}

/**
 * The host-cached table, used only while the transcript still shows it: a renderer
 * cannot inject rows, and a cleared or rewritten conversation does not resurrect it.
 */
export function hostReadResultFor(
  sessionId: string,
  messages: WorkspaceChatMessage[],
): TableArtifact | undefined {
  const cached = readResults.get(sessionId);
  if (!cached) return undefined;
  const latestShown = [...messages].reverse()
    .find((message) => message.role === 'assistant' && message.readResult)?.readResult;
  return latestShown?.id === cached.id ? cached : undefined;
}

/** Forget everything held for a deleted conversation (confirmations, its table and recipe). */
export function clearHostChatSession(sessionId: string): void {
  contextConfirmations.delete(sessionId);
  readResults.delete(sessionId);
  readRecipes.delete(sessionId);
}

/** The recipe of the table `hostReadResultFor` would return, under the same transcript check. */
export function hostReadRecipeFor(sessionId: string, messages: WorkspaceChatMessage[]): ChatReadRecipe | undefined {
  return hostReadResultFor(sessionId, messages) ? readRecipes.get(sessionId) : undefined;
}

export function clearHostChatStateForTests(): void {
  contextConfirmations.clear();
  readResults.clear();
  readRecipes.clear();
}
