import type { AgentContext, InvestigateAgentContext } from '../types.js';

/** Test doubles only; real providers are classified by where their requests go. */
const LOCAL_PROVIDER_NAMES = new Set(['mock', 'scripted']);

export function isCloudProvider(providerName: string): boolean {
  // The Claude and Codex CLIs both send prompts to their cloud models.
  return !LOCAL_PROVIDER_NAMES.has(providerName);
}

export function redactUntrustedContext(context: AgentContext): AgentContext {
  if (!('untrustedData' in context)) return context;
  const ctx = context as InvestigateAgentContext;
  return { ...ctx, untrustedData: undefined, evidence: [] };
}
