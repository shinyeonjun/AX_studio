import { z } from 'zod';
import type {
  DecisionAnswer,
  DecisionEngine,
  DecisionEvaluationRequest,
  DecisionEvaluationResult,
  DecisionQuestion,
} from '../../contracts/decision.js';
import { MAX_DECISION_CHOICE_CRITERIA } from '../../contracts/decision.js';

const ProbabilitySchema = z.number().min(0).max(1);

const JevAnswerSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('noul'),
    noul: ProbabilitySchema,
  }),
  z.object({
    type: z.literal('choice'),
    choice: z.string(),
    probabilities: z.record(ProbabilitySchema),
    confidence: ProbabilitySchema.nullish(),
  }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    probabilities: z.record(ProbabilitySchema),
    confidence: ProbabilitySchema.nullish(),
  }),
]);

const JevResponseSchema = z.object({
  model: z.string().nullish(),
  answers: z.unknown(),
  usage: z.object({
    input_tokens: z.number().nullish(),
    output_tokens: z.number().nullish(),
  }).nullish(),
});

const JEV_DEFAULT_TIMEOUT_MS = 30_000;
// ponytail: a synthetic 194 KiB request hit TypeSafe max_tokens_exceeded; 64 KiB batches preserve all questions without overrunning model input.
const JEV_DEFAULT_MAX_REQUEST_BYTES = 65_536;
// ponytail: 13-way synthetic fan-out hit system_overloaded once; keep all batches, but send at most four concurrently.
const JEV_MAX_CONCURRENT_BATCHES = 4;
const JEV_DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;

export interface JevDecisionEngineOptions {
  apiKey: string;
  model?: string;
  /** API root, matching TYPESAFE_BASE_URL semantics (for example https://api.typesafe.ai). */
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

export class JevDecisionError extends Error {
  readonly status?: number;
  readonly providerRequestCount?: number;
  readonly requestBytes?: number;

  constructor(message: string, status?: number, providerRequestCount?: number, cause?: unknown, requestBytes?: number) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'JevDecisionError';
    this.status = status;
    this.providerRequestCount = providerRequestCount;
    this.requestBytes = requestBytes;
  }
}

function validateQuestion(id: string, question: DecisionQuestion): void {
  if (question.type === 'choice') {
    const count = Object.keys(question.criteria).length;
    if (count < 1 || count > MAX_DECISION_CHOICE_CRITERIA) {
      throw new JevDecisionError(`Choice question ${id} must contain 1-${MAX_DECISION_CHOICE_CRITERIA} criteria.`);
    }
  }
  if (question.type === 'score' && question.criteria.length < 2) {
    throw new JevDecisionError(`Score question ${id} must contain at least 2 criteria.`);
  }
}

function toWireQuestion(question: DecisionQuestion): Record<string, unknown> {
  if (question.type === 'boolean') {
    return {
      type: 'noul',
      instructions: question.instructions,
    };
  }
  return { ...question };
}

function errorMessageFromBody(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const value = body as Record<string, unknown>;
  if (typeof value.message === 'string') return value.message;
  if (typeof value.error === 'string') return value.error;
  if (value.error && typeof value.error === 'object') {
    const nested = value.error as Record<string, unknown>;
    if (typeof nested.message === 'string') return nested.message;
  }
  if (typeof value.detail === 'string') return value.detail;
  if (value.detail && typeof value.detail === 'object') {
    const detail = value.detail as Record<string, unknown>;
    if (typeof detail.error_type === 'string') return detail.error_type;
  }
  if (typeof value.error_type === 'string') return value.error_type;
  return undefined;
}

async function readJson(response: Response, maxBytes: number): Promise<unknown> {
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new JevDecisionError('TypeSafe response is too large.', response.status);
  }
  const reader = response.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let text = '';
  let totalBytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) {
        text += decoder.decode();
        break;
      }
      totalBytes += chunk.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw new JevDecisionError('TypeSafe response is too large.', response.status);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new JevDecisionError(`TypeSafe returned invalid JSON (${response.status}).`, response.status);
  }
}

function mapAnswer(id: string, question: DecisionQuestion, raw: z.infer<typeof JevAnswerSchema>): DecisionAnswer {
  if (question.type === 'boolean') {
    if (raw.type !== 'noul') throw new JevDecisionError(`Unexpected answer type for ${id}: ${raw.type}`);
    return { type: 'boolean', probability: raw.noul };
  }
  if (question.type === 'choice') {
    if (raw.type !== 'choice') throw new JevDecisionError(`Unexpected answer type for ${id}: ${raw.type}`);
    if (!Object.prototype.hasOwnProperty.call(question.criteria, raw.choice)) {
      throw new JevDecisionError(`TypeSafe returned an unknown choice ${raw.choice} for ${id}.`);
    }
    return {
      type: 'choice',
      choice: raw.choice,
      probabilities: raw.probabilities,
      ...(raw.confidence == null ? {} : { confidence: raw.confidence }),
    };
  }
  if (raw.type !== 'score') throw new JevDecisionError(`Unexpected answer type for ${id}: ${raw.type}`);
  return {
    type: 'score',
    score: raw.score,
    probabilities: raw.probabilities,
    ...(raw.confidence == null ? {} : { confidence: raw.confidence }),
  };
}

function parseAnswers(value: unknown): Map<string, z.infer<typeof JevAnswerSchema>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JevDecisionError('TypeSafe response did not match the expected Jev schema: answers must be an object.');
  }
  const answers = new Map<string, z.infer<typeof JevAnswerSchema>>();
  for (const [id, raw] of Object.entries(value)) {
    const parsed = JevAnswerSchema.safeParse(raw);
    if (!parsed.success) {
      throw new JevDecisionError(`TypeSafe response did not match the expected Jev schema: ${parsed.error.message}`);
    }
    answers.set(id, parsed.data);
  }
  return answers;
}

/**
 * Thin adapter around TypeSafe's native System One endpoint.
 *
 * AX intentionally does not upgrade its existing AI SDK dependency just to use
 * Jev. The wire contract mirrors the official TypeSafe SDK: an API-root baseURL,
 * POST /v1/systemone, and AX boolean questions mapped to the `noul` primitive.
 */
export class JevDecisionEngine implements DecisionEngine {
  readonly dataHandling = 'cloud' as const;

  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;

  constructor(options: JevDecisionEngineOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new JevDecisionError('A TypeSafe API key is required.');
    this.apiKey = apiKey;
    this.model = options.model?.trim() || 'jev-latest';
    this.baseURL = (options.baseURL?.trim() || 'https://api.typesafe.ai').replace(/\/+$/, '');
    let parsedBaseURL: URL;
    try {
      parsedBaseURL = new URL(this.baseURL);
    } catch {
      throw new JevDecisionError('A valid TypeSafe base URL is required.');
    }
    const loopback = parsedBaseURL.hostname === 'localhost' ||
      parsedBaseURL.hostname === '127.0.0.1' ||
      parsedBaseURL.hostname === '[::1]' ||
      parsedBaseURL.hostname === '::1';
    if (parsedBaseURL.protocol !== 'https:' && !(parsedBaseURL.protocol === 'http:' && loopback)) {
      throw new JevDecisionError('TypeSafe base URL must use HTTPS (HTTP is allowed only for loopback development).');
    }
    this.headers = { ...options.headers };
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = typeof options.timeoutMs === 'number' && Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? options.timeoutMs
      : JEV_DEFAULT_TIMEOUT_MS;
    this.maxRequestBytes = typeof options.maxRequestBytes === 'number'
      && Number.isFinite(options.maxRequestBytes)
      && options.maxRequestBytes > 0
      ? options.maxRequestBytes
      : JEV_DEFAULT_MAX_REQUEST_BYTES;
    this.maxResponseBytes = typeof options.maxResponseBytes === 'number' && Number.isFinite(options.maxResponseBytes) && options.maxResponseBytes > 0
      ? options.maxResponseBytes
      : JEV_DEFAULT_MAX_RESPONSE_BYTES;
  }

  async evaluate(request: DecisionEvaluationRequest): Promise<DecisionEvaluationResult> {
    let providerRequestsStarted = 0;
    let providerRequestBytesStarted = 0;
    try {
      return await this.evaluateRequest(request, (bytes) => {
        providerRequestsStarted += 1;
        providerRequestBytesStarted += bytes;
      });
    } catch (error) {
      if (request.signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new JevDecisionError(
        message,
        error instanceof JevDecisionError ? error.status : undefined,
        providerRequestsStarted,
        error,
        providerRequestBytesStarted,
      );
    }
  }

  private async evaluateRequest(
    request: DecisionEvaluationRequest,
    onProviderRequest: (bytes: number) => void,
  ): Promise<DecisionEvaluationResult> {
    const evaluateBatch = (
      batchRequest: DecisionEvaluationRequest,
      entries: Array<[string, DecisionQuestion]>,
      body: string,
      requestBytes: number,
    ) => this.evaluateBatch(batchRequest, entries, body, requestBytes, onProviderRequest);

    const entries = Object.entries(request.questions);
    if (!entries.length) return { answers: {}, model: this.model, providerRequestCount: 0, requestBytes: 0 };
    for (const [id, question] of entries) validateQuestion(id, question);

    let body: string;
    try {
      body = JSON.stringify({
        model: this.model,
        state: request.state,
        questions: Object.fromEntries(entries.map(([id, question]) => [id, toWireQuestion(question)])),
      });
    } catch {
      throw new JevDecisionError('TypeSafe request could not be serialized.');
    }
    const requestBytes = new TextEncoder().encode(body).byteLength;
    if (requestBytes <= this.maxRequestBytes) {
      return await evaluateBatch(request, entries, body, requestBytes);
    }

    const batches = this.splitRequest(body, entries);
    if (batches.length === 1) {
      const batch = batches[0]!;
      return await evaluateBatch(request, batch.entries, batch.body, batch.bytes);
    }

    if (request.signal?.aborted) {
      throw request.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    }
    const controller = new AbortController();
    const abortExternal = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', abortExternal, { once: true });
    if (request.signal?.aborted) abortExternal();
    try {
      const results: DecisionEvaluationResult[] = [];
      for (let offset = 0; offset < batches.length; offset += JEV_MAX_CONCURRENT_BATCHES) {
        const wave = await Promise.all(batches.slice(offset, offset + JEV_MAX_CONCURRENT_BATCHES).map(async batch => {
          try {
            return await evaluateBatch({ ...request, signal: controller.signal }, batch.entries, batch.body, batch.bytes);
          } catch (error) {
            controller.abort(error);
            throw error;
          }
        }));
        results.push(...wave);
      }
      const answers = Object.fromEntries(results.flatMap(result => Object.entries(result.answers)));
      const sumUsage = (key: 'inputTokens' | 'outputTokens') => {
        const values = results.map(result => result.usage?.[key]);
        return values.every((value): value is number => value !== undefined)
          ? values.reduce((total, value) => total + value, 0)
          : undefined;
      };
      const inputTokens = sumUsage('inputTokens');
      const outputTokens = sumUsage('outputTokens');
      const hasUsage = results.some(result => result.usage !== undefined);
      return {
        answers,
        model: results[0]?.model ?? this.model,
        providerRequestCount: results.reduce((total, result) => total + (result.providerRequestCount ?? 1), 0),
        requestBytes: results.reduce((total, result) => total + (result.requestBytes ?? 0), 0),
        ...(hasUsage
          ? {
              usage: {
                ...(inputTokens === undefined ? {} : { inputTokens }),
                ...(outputTokens === undefined ? {} : { outputTokens }),
              },
            }
          : {}),
      };
    } finally {
      request.signal?.removeEventListener('abort', abortExternal);
    }
  }

  private splitRequest(
    body: string,
    entries: Array<[string, DecisionQuestion]>,
  ): Array<{ entries: Array<[string, DecisionQuestion]>; body: string; bytes: number }> {
    let wireRequest: { model: string; state?: unknown; questions: Record<string, unknown> };
    let emptyBody: string;
    try {
      wireRequest = JSON.parse(body) as typeof wireRequest;
      emptyBody = JSON.stringify({ model: wireRequest.model, state: wireRequest.state, questions: {} });
    } catch {
      throw new JevDecisionError('TypeSafe request could not be serialized.');
    }
    const marker = '"questions":{}';
    const markerIndex = emptyBody.lastIndexOf(marker);
    if (markerIndex < 0) throw new JevDecisionError('TypeSafe request could not be serialized.');
    const valueStart = markerIndex + '"questions":'.length;
    const baseBytes = new TextEncoder().encode(emptyBody).byteLength;
    if (baseBytes > this.maxRequestBytes) throw new JevDecisionError('TypeSafe request is too large.');

    const wireEntries = Object.entries(wireRequest.questions);
    const batches: Array<{ entries: Array<[string, DecisionQuestion]>; body: string; bytes: number }> = [];
    let batchEntries: Array<[string, DecisionQuestion]> = [];
    let batchWireEntries: string[] = [];
    let batchBytes = baseBytes;
    const encoder = new TextEncoder();
    const finishBatch = () => {
      const questionsJson = batchWireEntries.join(',');
      batches.push({
        entries: batchEntries,
        body: `${emptyBody.slice(0, valueStart)}{${questionsJson}}${emptyBody.slice(valueStart + 2)}`,
        bytes: batchBytes,
      });
      batchEntries = [];
      batchWireEntries = [];
      batchBytes = baseBytes;
    };

    for (let index = 0; index < entries.length; index++) {
      const [id, question] = entries[index]!;
      const wireQuestion = wireEntries[index]?.[1];
      let wireEntry: string;
      try {
        wireEntry = `${JSON.stringify(id)}:${JSON.stringify(wireQuestion)}`;
      } catch {
        throw new JevDecisionError('TypeSafe request could not be serialized.');
      }
      const entryBytes = encoder.encode(wireEntry).byteLength;
      if (baseBytes + entryBytes > this.maxRequestBytes) {
        throw new JevDecisionError('TypeSafe request is too large.');
      }
      const separatorBytes = batchEntries.length ? 1 : 0;
      if (batchBytes + separatorBytes + entryBytes > this.maxRequestBytes) finishBatch();
      batchEntries.push([id, question]);
      batchWireEntries.push(wireEntry);
      batchBytes += (batchEntries.length > 1 ? 1 : 0) + entryBytes;
    }
    if (batchEntries.length) finishBatch();
    return batches;
  }

  private async evaluateBatch(
    request: DecisionEvaluationRequest,
    entries: Array<[string, DecisionQuestion]>,
    body: string,
    requestBytes: number,
    onProviderRequest: (bytes: number) => void,
  ): Promise<DecisionEvaluationResult> {

    if (request.signal?.aborted) {
      throw request.signal.reason ?? new DOMException('The operation was aborted.', 'AbortError');
    }

    const controller = new AbortController();
    let timedOut = false;
    const abortExternal = () => controller.abort(request.signal?.reason);
    request.signal?.addEventListener('abort', abortExternal, { once: true });
    if (request.signal?.aborted) abortExternal();
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.timeoutMs);
    let response: Response;
    let rawBody: unknown;
    try {
      onProviderRequest(requestBytes);
      response = await this.fetchImpl(`${this.baseURL}/v1/systemone`, {
        method: 'POST',
        headers: {
          ...this.headers,
          Authorization: `Bearer ${this.apiKey}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body,
        signal: controller.signal,
      });
      rawBody = await readJson(response, this.maxResponseBytes);
    } catch (error) {
      if (timedOut) throw new JevDecisionError('TypeSafe request timed out.');
      throw error;
    } finally {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abortExternal);
    }
    if (!response.ok) {
      throw new JevDecisionError(
        errorMessageFromBody(rawBody) ?? `TypeSafe request failed with status ${response.status}.`,
        response.status,
      );
    }

    const parsed = JevResponseSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new JevDecisionError(`TypeSafe response did not match the expected Jev schema: ${parsed.error.message}`);
    }
    const parsedAnswers = parseAnswers(parsed.data.answers);

    const answers = Object.fromEntries(entries.map(([id, question]) => {
      const rawAnswer = parsedAnswers.get(id);
      if (!rawAnswer) throw new JevDecisionError(`TypeSafe response is missing answer ${id}.`);
      return [id, mapAnswer(id, question, rawAnswer)];
    }));

    return {
      answers,
      ...(parsed.data.model ? { model: parsed.data.model } : { model: this.model }),
      providerRequestCount: 1,
      requestBytes,
      ...(parsed.data.usage
        ? {
            usage: {
              ...(parsed.data.usage.input_tokens == null ? {} : { inputTokens: parsed.data.usage.input_tokens }),
              ...(parsed.data.usage.output_tokens == null ? {} : { outputTokens: parsed.data.usage.output_tokens }),
            },
          }
        : {}),
    };
  }
}
