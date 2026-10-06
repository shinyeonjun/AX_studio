import { afterEach, describe, expect, it, vi } from 'vitest';
import { ollamaApiBaseUrl } from './ollama-api.js';
import { isCloudProvider } from '../harness/policy.js';

describe('Ollama base URL', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['', 'http://localhost:11434/v1'],
    ['http://localhost:11434/', 'http://localhost:11434/v1'],
    ['http://localhost:11434/v1/', 'http://localhost:11434/v1'],
    ['127.0.0.1:11434', 'http://127.0.0.1:11434/v1'],
  ])('normalizes %j', (configured, expected) => {
    vi.stubEnv('OLLAMA_BASE_URL', configured);
    vi.stubEnv('OLLAMA_HOST', '');
    expect(ollamaApiBaseUrl()).toBe(expected);
  });

  it('treats Ollama as local only while it targets loopback', () => {
    vi.stubEnv('OLLAMA_HOST', '');
    vi.stubEnv('OLLAMA_BASE_URL', 'http://127.0.0.1:11434');
    expect(isCloudProvider('ollama-api')).toBe(false);
    vi.stubEnv('OLLAMA_BASE_URL', 'https://ollama.example.com');
    expect(isCloudProvider('ollama-api')).toBe(true);
    expect(isCloudProvider('openai-compatible')).toBe(true);
    expect(isCloudProvider('mock')).toBe(false);
  });
});
