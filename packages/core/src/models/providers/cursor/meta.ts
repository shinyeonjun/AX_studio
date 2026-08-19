import type { CliModelOption } from '../grok/meta.js';
import { GROK_MODELS } from '../grok/meta.js';

export const CURSOR_CLI_MODELS: CliModelOption[] = GROK_MODELS;

export const CURSOR_META = {
  label: 'Cursor',
  description: 'Cursor API 키 + agent CLI',
  binaries: ['agent', 'cursor-agent'] as const,
  defaultModel: 'grok-4.6',
  models: CURSOR_CLI_MODELS,
  envKey: 'CURSOR_API_KEY',
};
