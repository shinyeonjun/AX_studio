import type { CliModelOption } from '../../model-options.js';

function claudeModel(id: string, label: string): CliModelOption {
  return { id, label };
}

/** Claude Code picker와 동일한 8개 고정. */
export const CLAUDE_CLI_MODELS: CliModelOption[] = [
  claudeModel('fable', 'Fable 5'),
  claudeModel('opus', 'Opus 5'),
  claudeModel('sonnet', 'Sonnet 5'),
  claudeModel('haiku', 'Haiku 4.5'),
  claudeModel('claude-opus-4-8', 'Opus 4.8'),
  claudeModel('claude-opus-4-7', 'Opus 4.7'),
  claudeModel('claude-opus-4-6', 'Opus 4.6'),
  claudeModel('claude-sonnet-4-6', 'Sonnet 4.6'),
];

export const CLAUDE_API_MODELS: CliModelOption[] = [
  claudeModel('claude-sonnet-4-6', 'Sonnet 4.6'),
  claudeModel('claude-opus-4-6', 'Opus 4.6'),
  claudeModel('claude-opus-5', 'Opus 5'),
  claudeModel('claude-3-5-haiku-latest', 'Haiku 3.5'),
];

export const CLAUDE_META = {
  label: 'Claude CLI',
  description: '설치된 Claude Code CLI',
  binaries: ['claude'] as const,
  defaultModel: 'sonnet',
  cliModels: CLAUDE_CLI_MODELS,
  apiModels: CLAUDE_API_MODELS,
  apiDefaultModel: 'claude-sonnet-4-6',
  envKey: 'ANTHROPIC_API_KEY',
};

const CLAUDE_CLI_MODEL_ALIASES: Record<string, string> = {
  best: 'fable',
  'claude-fable-5': 'fable',
  'claude-opus-5': 'opus',
  'claude-sonnet-5': 'sonnet',
  'claude-haiku-4-5': 'haiku',
};

export function resolveClaudeCliModelId(id: string): string {
  const trimmed = id.trim();
  if (CLAUDE_CLI_MODELS.some((model) => model.id === trimmed)) return trimmed;
  const withoutContext = trimmed.replace(/\[1m\]$/, '');
  const aliased = CLAUDE_CLI_MODEL_ALIASES[withoutContext];
  if (aliased) return aliased;
  if (CLAUDE_CLI_MODELS.some((model) => model.id === withoutContext)) return withoutContext;
  return CLAUDE_META.defaultModel;
}

export function labelClaudeModelId(id: string): CliModelOption {
  const resolved = resolveClaudeCliModelId(id);
  return CLAUDE_CLI_MODELS.find((model) => model.id === resolved) ?? claudeModel(resolved, resolved);
}
