import type { AgentContext, InvestigateAgentContext } from '../types.js';

const LOCAL_PROVIDER_NAMES = new Set(['mock', 'scripted', 'openai-compatible']);

export function isCloudProvider(providerName: string): boolean {
  if (LOCAL_PROVIDER_NAMES.has(providerName)) return false;
  if (providerName.includes('ollama')) return false;
  return true;
}

export function redactUntrustedContext(context: AgentContext): AgentContext {
  if (!('untrustedData' in context)) return context;
  const ctx = context as InvestigateAgentContext;
  return { ...ctx, untrustedData: undefined, evidence: [] };
}
