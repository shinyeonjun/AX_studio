import type {
  DecisionEngine,
  DecisionEvaluationRequest,
  DecisionEvaluationResult,
  DecisionQuestion,
} from '../../../contracts/decision.js';
import { mergeBatchResults, splitJevRequest } from './batching.js';
import { JevDecisionError, validateJevApiKey } from './errors.js';
import {
  createRequestHeaders,
  errorMessageFromBody,
  JevResponseSchema,
  mapAnswer,
  parseAnswers,
  readJson,
  toWireQuestion,
  validateQuestion,
} from './wire.js';

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
    validateJevApiKey(options.apiKey);
    this.apiKey = options.apiKey;
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
        error instanceof JevDecisionError ? error.failure : undefined,
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

    const batches = splitJevRequest(body, entries, this.maxRequestBytes);
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
      return mergeBatchResults(results, this.model);
    } finally {
      request.signal?.removeEventListener('abort', abortExternal);
    }
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
      const headers = createRequestHeaders(this.apiKey, this.headers);
      onProviderRequest(requestBytes);
      response = await this.fetchImpl(`${this.baseURL}/v1/systemone`, {
        method: 'POST',
        headers,
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
    // A provider error/unknown envelope key cannot masquerade as a clean omission,
    // even with HTTP 200. Ordinary successful-answer parsing stays unchanged.
    const cleanOmission = Object.keys(request.questions).length === 1 && parsedAnswers.size === 0
      && JevResponseSchema.strict().safeParse(rawBody).success;

    const answers = Object.fromEntries(entries.map(([id, question]) => {
      const rawAnswer = parsedAnswers.get(id);
      if (!rawAnswer) throw new JevDecisionError(`TypeSafe response is missing answer ${id}.`,
        undefined, undefined, undefined, undefined,
        cleanOmission ? { kind: 'missing_answer', questionRef: id } : undefined);
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
