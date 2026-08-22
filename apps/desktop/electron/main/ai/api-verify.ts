export async function verifyAnthropicApiKey(apiKey: string): Promise<{ ok: true; label: string }> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-3-5-haiku-latest',
      max_tokens: 1,
      messages: [{ role: 'user', content: 'ping' }],
    }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Anthropic API 키가 유효하지 않습니다.');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Anthropic API 확인 실패 (${response.status})`);
  }
  return { ok: true, label: 'Anthropic API 연결됨' };
}

export async function verifyOpenAiApiKey(apiKey: string): Promise<{ ok: true; label: string }> {
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (response.status === 401) {
    throw new Error('OpenAI API 키가 유효하지 않습니다.');
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `OpenAI API 확인 실패 (${response.status})`);
  }
  return { ok: true, label: 'OpenAI API 연결됨' };
}

export async function verifyOllamaApi(): Promise<{ ok: true; label: string }> {
  const base = (process.env.OLLAMA_BASE_URL?.trim() || process.env.OLLAMA_HOST?.trim() || 'http://localhost:11434')
    .replace(/\/$/, '');
  const response = await fetch(`${base}/api/tags`);
  if (!response.ok) {
    const text = await response.text();
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
