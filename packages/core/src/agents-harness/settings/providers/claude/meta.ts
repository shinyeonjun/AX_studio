import { exactModelOptions } from '../../model-options.js';

export const CLAUDE_CLI_MODELS = exactModelOptions([
  'sonnet',
  'opus',
  'haiku',
  'fable',
  'sonnet[1m]',
  'opus[1m]',
]);

export const CLAUDE_API_MODELS = exactModelOptions([
  'claude-sonnet-4-20250514',
  'claude-opus-4-20250514',
  'claude-3-5-haiku-latest',
]);

export const CLAUDE_META = {
  label: 'Claude CLI',
  description: '설치된 Claude Code CLI',
  binaries: ['claude'] as const,
  defaultModel: 'sonnet',
  cliModels: CLAUDE_CLI_MODELS,
  apiModels: CLAUDE_API_MODELS,
  apiDefaultModel: 'claude-sonnet-4-20250514',
  envKey: 'ANTHROPIC_API_KEY',
};
