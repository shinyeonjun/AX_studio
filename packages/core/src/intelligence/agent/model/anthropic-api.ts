import { reportModelTokenUsage, type ModelProvider, type ModelTokenUsage, type StructuredGenerateInput, type TextGenerateInput } from './provider.js';
import { chatMessagesFromInput } from './chat.js';
import { parseStructuredOutput } from './cli-json.js';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MAX_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 500;
const MAX_RETRY_DELAY_MS = 8_000;
const DEFAULT_MAX_TOKENS = 16_000;
const MAX_ERROR_BODY_CHARS = 2_048;

export function toAnthropicMessages(input: {
  system: string;
  user?: string;
  messages?: import('./chat.js').ChatMessage[];
  images?: import('./provider.js').ModelImageInput[];
}) {
  const messages = chatMessagesFromInput(input);
  let lastUserIndex = -1;
  messages.forEach((message, index) => {
    if (message.role === 'user') lastUserIndex = index;
  });
  return messages.map((message, index) => {
    if (index !== lastUserIndex || !input.images?.length) {
      return { role: message.role, content: message.content };
    }
    return {
      role: message.role,
      content: [
        { type: 'text' as const, text: message.content },
        ...input.images.map((image) => ({
          type: 'image' as const,
          source: {
            type: 'base64' as const,
            media_type: image.mimeType,
            data: Buffer.from(image.data).toString('base64'),
          },
        })),
      ],
    };
  });
}

function requireAnthropicApiKey(): string {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (!key) {
    throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다. 설정에서 API 키를 등록하세요.');
  }
  return key;
}

/** Sampling parameters are rejected (HTTP 400) from Opus 4.7 / Sonnet 5 / Fable onward. */
export function anthropicModelAcceptsTemperature(model: string): boolean {
  return !/^claude-(?:fable|mythos|opus-5|sonnet-5|opus-4-[789])/.test(model);
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status === 529 || status >= 500;
}

/** Honors `retry-after` (seconds or HTTP date), else exponential backoff with full jitter. */
export function anthropicRetryDelayMs(attempt: number, retryAfter: string | null, random = Math.random): number {
  if (retryAfter) {
    const seconds = Number(retryAfter);
    const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, MAX_RETRY_DELAY_MS * 4);
  }
  return Math.round(random() * Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** attempt));
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function requestSignal(input: { abortSignal?: AbortSignal; timeoutMs?: number }): AbortSignal {
  const signals = [input.abortSignal, input.timeoutMs ? AbortSignal.timeout(input.timeoutMs) : undefined]
    .filter((signal): signal is AbortSignal => Boolean(signal));
  return signals.length === 1 ? signals[0]! : AbortSignal.any(signals);
}

interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
}

async function postMessages(body: string, signal: AbortSignal): Promise<AnthropicResponse> {
  for (let attempt = 0; ; attempt += 1) {
    const last = attempt === MAX_ATTEMPTS - 1;
    let response: Response;
    try {
      response = await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers: {
          'x-api-key': requireAnthropicApiKey(),
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        signal,
        body,
      });
    } catch (error) {
      if (signal.aborted || last) throw error;
      await sleep(anthropicRetryDelayMs(attempt, null), signal);
      continue;
    }
    if (response.ok) return (await response.json()) as AnthropicResponse;
    if (!last && isRetryableStatus(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      await sleep(anthropicRetryDelayMs(attempt, response.headers.get('retry-after')), signal);
      continue;
    }
    const text = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_CHARS);
    throw Object.assign(new Error(text || `Anthropic API 호출 실패 (${response.status})`), { status: response.status });
  }
}

async function callAnthropic(
  model: string,
  system: string,
  input: {
    user?: string;
    messages?: import('./chat.js').ChatMessage[];
    images?: import('./provider.js').ModelImageInput[];
    abortSignal?: AbortSignal;
    timeoutMs?: number;
    maxOutputTokens?: number;
  },
  temperature: number,
): Promise<{ text: string; usage: ModelTokenUsage }> {
  const data = await postMessages(JSON.stringify({
    model,
    max_tokens: input.maxOutputTokens ?? DEFAULT_MAX_TOKENS,
    system,
    messages: toAnthropicMessages({ system, ...input }),
    ...(anthropicModelAcceptsTemperature(model) ? { temperature } : {}),
  }), requestSignal(input));
  if (data.stop_reason === 'max_tokens') {
    throw Object.assign(new Error('Anthropic API 응답이 최대 토큰 수에서 잘렸습니다.'), { code: 'model_output_truncated' });
  }
  if (data.stop_reason === 'refusal') {
    throw Object.assign(new Error('Anthropic API가 요청을 거절했습니다.'), { code: 'model_refused' });
  }
  const text = (data.content ?? [])
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('')
    .trim();
  if (!text) throw new Error('Anthropic API 응답이 비어 있습니다.');
  const inputTokens = data.usage?.input_tokens;
  const outputTokens = data.usage?.output_tokens;
  const cachedInputTokens = data.usage?.cache_read_input_tokens;
  const cacheCreationInputTokens = data.usage?.cache_creation_input_tokens;
  return {
    text,
    usage: {
      inputTokens,
      outputTokens,
      cachedInputTokens,
      cacheWriteInputTokens: cacheCreationInputTokens,
      ...(inputTokens !== undefined && outputTokens !== undefined
        ? { totalTokens: inputTokens + outputTokens + (cachedInputTokens ?? 0) + (cacheCreationInputTokens ?? 0) }
        : {}),
    },
  };
}

export class AnthropicApiProvider implements ModelProvider {
  readonly name = 'anthropic-api';
  readonly supportsVision = true;

  constructor(readonly model: string) {}

  async generateText(input: TextGenerateInput): Promise<string> {
    const result = await callAnthropic(this.model, input.system, input, input.temperature ?? 0.3);
    reportModelTokenUsage(input, result.usage);
    return result.text;
  }

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    const system = `${input.system}\n\nReturn JSON only that matches the schema. No markdown.`;
    const result = await callAnthropic(this.model, system, input, input.temperature ?? 0.2);
    reportModelTokenUsage(input, result.usage);
    return parseStructuredOutput(result.text, input.schema);
  }
}

export function isAnthropicApiKeyConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
