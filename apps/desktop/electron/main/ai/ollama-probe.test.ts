import { describe, expect, it, vi } from 'vitest';

const fetchText = vi.hoisted(() => vi.fn());
vi.mock('../fetch-timeout.js', () => ({ fetchTextWithTimeout: fetchText }));

import { ollamaRunning } from './api-verify.js';

describe('asking whether Ollama is running', () => {
  it('answers yes when its server answers', async () => {
    fetchText.mockResolvedValueOnce({ response: { ok: true, status: 200 }, text: '{}' });
    await expect(ollamaRunning()).resolves.toBe(true);
  });

  it('answers no, without failing, when nothing is listening', async () => {
    fetchText.mockRejectedValueOnce(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));
    await expect(ollamaRunning()).resolves.toBe(false);
  });
});
