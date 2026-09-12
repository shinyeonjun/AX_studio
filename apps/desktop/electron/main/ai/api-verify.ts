import { fetchTextWithTimeout } from '../fetch-timeout.js';

export async function verifyAnthropicApiKey(apiKey: string): Promise<{ ok: true; label: string }> {
  const { response, text } = await fetchTextWithTimeout('https://api.anthropic.com/v1/models', {
    method: 'GET',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
  });
  if (response.status === 401) {
    throw new Error('Anthropic API 키가 유효하지 않습니다.');
  }
  if (response.status === 403) {
    throw new Error('Anthropic API 키에 모델 조회 권한이 없습니다.');
  }
  if (response.status === 429) {
    throw new Error('Anthropic API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.');
  }
  if (!response.ok) {
    throw new Error(text || `Anthropic API 확인 실패 (${response.status})`);
  }
  return { ok: true, label: 'Anthropic API 키 인증됨' };
}

export async function verifyOpenAiApiKey(apiKey: string): Promise<{ ok: true; label: string }> {
  const { response, text } = await fetchTextWithTimeout('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.status === 401) {
    throw new Error('OpenAI API 키가 유효하지 않습니다.');
  }
  if (response.status === 429) {
    throw new Error('OpenAI API 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.');
  }
  if (!response.ok) {
    throw new Error(text || `OpenAI API 확인 실패 (${response.status})`);
  }
  return { ok: true, label: 'OpenAI API 연결됨' };
}

export async function verifyOllamaApi(): Promise<{ ok: true; label: string }> {
  const base = (process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_HOST?.trim() || 'http://localhost:11434')
    .replace(/\/$/, '');
  const { response, text } = await fetchTextWithTimeout(`${base}/api/tags`);
  if (!response.ok) {
    throw new Error(text || `Ollama 연결 확인 실패 (${response.status})`);
  }
  return { ok: true, label: 'Ollama 로컬 서버 연결됨' };
}

export async function verifyAiApiKey(
  brand: 'claude' | 'gpt' | 'ollama',
  apiKey?: string,
): Promise<{ ok: true; label: string }> {
  if (brand === 'ollama') return verifyOllamaApi();
  if (!apiKey) throw new Error('API 키가 없습니다.');
  if (brand === 'claude') return verifyAnthropicApiKey(apiKey);
  return verifyOpenAiApiKey(apiKey);
}
