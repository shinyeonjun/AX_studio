import { exactModelOptions } from '../../model-options.js';

/** 로컬 Ollama OpenAI-compatible API */
export const OLLAMA_API_MODELS = exactModelOptions(['llama3.3', 'qwen2.5']);

export const OLLAMA_META = {
  label: 'Ollama',
  description: '로컬 Ollama · OpenAI-compatible API',
  enabled: true,
  baseURL: 'http://localhost:11434/v1',
  apiModels: OLLAMA_API_MODELS,
  apiDefaultModel: 'llama3.3',
  envKey: 'OLLAMA_API_KEY',
};
