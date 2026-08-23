import { claudeCommandTransport } from './transports/claude.js';
import { codexCommandTransport } from './transports/codex.js';
import { directCommandTransport } from './transports/direct.js';
import type { AxCommandChatTransport } from './transport-contract.js';

export type { AxCommandChatOutput, AxCommandChatTransport } from './transport-contract.js';
export { AxCommandChatOutputSchema } from './transport-contract.js';

/** Selects only the wire adapter; command orchestration remains provider-neutral. */
export function createAxCommandChatTransport(providerName: string): AxCommandChatTransport {
  if (providerName === 'codex-cli') return codexCommandTransport;
  if (providerName === 'claude-cli') return claudeCommandTransport;
  return directCommandTransport;
}
