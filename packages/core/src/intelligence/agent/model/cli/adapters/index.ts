import type { CliProviderId } from '../../../settings/ai-provider-id.js';
import type { ModelProvider } from '../../provider.js';
import { ClaudeCliProvider } from './claude-cli.js';
import { CodexCliProvider } from './codex-cli.js';

export { ClaudeCliProvider } from './claude-cli.js';
export { CodexCliProvider } from './codex-cli.js';

export function createCliModelProvider(provider: CliProviderId, model: string): ModelProvider {
  if (provider === 'codex-cli') return new CodexCliProvider(model);
  return new ClaudeCliProvider(model);
}
