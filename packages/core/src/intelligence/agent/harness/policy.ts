import { ollamaApiBaseUrl } from '../model/ollama-api.js';
import type { AgentContext, InvestigateAgentContext } from '../types.js';

/** Test doubles only; real providers are classified by where their requests go. */
const LOCAL_PROVIDER_NAMES = new Set(['mock', 'scripted']);

function isLoopbackUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '').toLowerCase();
    return host === 'localhost' || host === '::1' || host === '0.0.0.0' || /^127(?:\.\d{1,3}){3}$/.test(host);
  } catch {
    return false;
  }
}

export function isCloudProvider(providerName: string): boolean {
  if (LOCAL_PROVIDER_NAMES.has(providerName)) return false;
  // Ollama is local only while OLLAMA_BASE_URL/OLLAMA_HOST point at this machine.
  if (providerName.includes('ollama')) return !isLoopbackUrl(ollamaApiBaseUrl());
  return true;
}

export function redactUntrustedContext(context: AgentContext): AgentContext {
  if (!('untrustedData' in context)) return context;
  const ctx = context as InvestigateAgentContext;
  return { ...ctx, untrustedData: undefined, evidence: [] };
}
