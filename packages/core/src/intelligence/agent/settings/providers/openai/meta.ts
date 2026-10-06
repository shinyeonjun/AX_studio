import { exactModelOptions } from '../../model-options.js';

/** Shared by Codex CLI and the OpenAI API so both modes start on the same model. */
export const OPENAI_DEFAULT_MODEL = 'gpt-5.4';

/** Codex CLI 미탐지 시 fallback */
export const OPENAI_CLI_MODELS = exactModelOptions([
  OPENAI_DEFAULT_MODEL,
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
]);

export const OPENAI_API_MODELS = exactModelOptions([
  OPENAI_DEFAULT_MODEL,
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-4.1',
  'gpt-4.1-mini',
  'gpt-4o',
  'gpt-4o-mini',
  'o3',
  'o4-mini',
]);

export const OPENAI_META = {
  label: 'Codex CLI',
  description: '설치된 OpenAI Codex CLI',
  binaries: ['codex'] as const,
  defaultModel: OPENAI_DEFAULT_MODEL,
  cliModels: OPENAI_CLI_MODELS,
  apiModels: OPENAI_API_MODELS,
  apiDefaultModel: OPENAI_DEFAULT_MODEL,
  envKey: 'OPENAI_API_KEY',
};
