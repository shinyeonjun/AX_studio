import { exactModelOptions } from '../../model-options.js';

/** 로컬 Ollama — v1 이후 OpenAI-compatible API 경로로 연결 예정 */
export const OLLAMA_API_MODELS = exactModelOptions(['llama3.3', 'qwen2.5']);

export const OLLAMA_META = {
  label: 'Ollama',
  description: '로컬 Ollama (준비 중)',
  enabled: false,
  baseURL: 'http://localhost:11434/v1',
  apiModels: OLLAMA_API_MODELS,
  apiDefaultModel: 'llama3.3',
  envKey: 'OLLAMA_API_KEY',
};
