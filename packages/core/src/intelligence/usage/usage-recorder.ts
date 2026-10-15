import { AsyncLocalStorage } from 'node:async_hooks';

/** Which engine made a call: Jev answering decision questions, or an LLM. */
export type UsageEngine = 'jev' | 'llm';

/** What the call was for: deciding what to do, or writing text (replies, summaries, investigations). */
export type UsagePurpose = 'decision' | 'generation';

/**
 * One model call as the Usage screen counts it. Token fields left out mean the provider did not
 * report them (unknown), not zero. Nothing of the prompt or the answer is kept.
 */
export interface UsageCall {
  engine: UsageEngine;
  purpose: UsagePurpose;
  /** Where in the app the call came from, e.g. an agent phase; absent for decisions. */
  label?: string;
  provider?: string;
  model?: string;
  durationMs: number;
  providerRequests?: number;
  /** All input tokens, including those read from or written to the provider's cache. */
  inputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  requestBytes?: number;
  ok: boolean;
}

/** A recorded call with the chat request it belonged to and when it ended. */
export interface StoredUsageCall extends UsageCall {
  requestId?: string;
  workspaceSessionId?: string;
  createdAt: string;
}

interface UsageContext {
  requestId?: string;
  workspaceSessionId?: string;
}

const context = new AsyncLocalStorage<UsageContext>();
let recorder: ((call: StoredUsageCall) => void) | undefined;

/** The host's sink for calls (the app database); unset in tests and tools, where calls are not kept. */
export function setUsageRecorder(next: ((call: StoredUsageCall) => void) | undefined): void {
  recorder = next;
}

/** Calls made inside `run` are recorded as part of this chat request. */
export function runWithUsageContext<T>(value: UsageContext, run: () => T): T {
  return context.run(value, run);
}

/** Records one call. Never throws: counting usage must not break the request it measures. */
export function recordUsageCall(call: UsageCall): void {
  if (!recorder) return;
  const current = context.getStore();
  try {
    recorder({
      ...call,
      ...(current?.requestId ? { requestId: current.requestId } : {}),
      ...(current?.workspaceSessionId ? { workspaceSessionId: current.workspaceSessionId } : {}),
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('[AX Studio] usage record failed', { code: (error as { code?: unknown } | null)?.code });
  }
}
