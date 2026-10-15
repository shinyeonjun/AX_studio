import { exactModelOptions } from '../../model-options.js';

/** Codex CLI's default model. */
const OPENAI_DEFAULT_MODEL = 'gpt-5.4';

/** Codex CLI 미탐지 시 fallback */
const OPENAI_CLI_MODELS = exactModelOptions([
  OPENAI_DEFAULT_MODEL,
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
]);

export const OPENAI_META = {
  label: 'Codex CLI',
  description: '설치된 OpenAI Codex CLI',
  binaries: ['codex'] as const,
  defaultModel: OPENAI_DEFAULT_MODEL,
  cliModels: OPENAI_CLI_MODELS,
};
