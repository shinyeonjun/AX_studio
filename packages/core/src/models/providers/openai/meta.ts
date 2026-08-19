import { exactModelOptions } from '../../model-options.js';

export interface CliModelOption {
  id: string;
  label: string;
}

/** Codex CLI 미탐지 시 fallback */
export const OPENAI_CLI_MODELS = exactModelOptions([
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.1-codex',
  'gpt-5.1-codex-mini',
]);

export const OPENAI_API_MODELS = exactModelOptions([
  'gpt-4o',
  'gpt-4o-mini',
  'gpt-4.1',
  'gpt-4.1-mini',
  'o3',
  'o4-mini',
  'gpt-5.4',
]);

export const OPENAI_META = {
  label: 'Codex CLI',
  description: '설치된 OpenAI Codex CLI',
  binaries: ['codex'] as const,
  defaultModel: 'gpt-5.4',
  cliModels: OPENAI_CLI_MODELS,
  apiModels: OPENAI_API_MODELS,
  apiDefaultModel: 'gpt-4o',
  envKey: 'OPENAI_API_KEY',
};
