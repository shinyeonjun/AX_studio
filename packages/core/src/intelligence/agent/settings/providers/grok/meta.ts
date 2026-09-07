import { exactModelOptions } from '../../model-options.js';

export const GROK_MODELS = exactModelOptions([
  'grok-4.6-high',
  'grok-4.6',
  'grok-4.5-high-fast',
  'grok-4.5',
  'grok',
]);

export const GROK_META = {
  label: 'Grok',
  description: 'xAI Grok · Cursor agent CLI 또는 xAI API',
  cliModels: GROK_MODELS,
  apiModels: GROK_MODELS,
  apiDefaultModel: 'grok-4.6',
  envKey: 'CURSOR_API_KEY',
};
