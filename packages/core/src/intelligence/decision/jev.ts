import { z } from 'zod';
import type {
  DecisionAnswer,
  DecisionEngine,
  DecisionEvaluationRequest,
  DecisionEvaluationResult,
  DecisionQuestion,
} from '../../contracts/decision.js';

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
    confidence: z.number().nullish(),
  }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    probabilities: z.record(ProbabilitySchema),
    confidence: z.number().nullish(),
  }),
]);

const JevResponseSchema = z.object({
  model: z.string().nullish(),
  answers: z.record(JevAnswerSchema),
  usage: z.object({
    input_tokens: z.number().nullish(),
    output_tokens: z.number().nullish(),
  }).nullish(),
});

export interface JevDecisionEngineOptions {
  apiKey: string;
  model?: string;
  /** API root, matching TYPESAFE_BASE_URL semantics (for example https://api.typesafe.ai). */
  baseURL?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}

export class JevDecisionError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'JevDecisionError';
    this.status = status;
  }
}

function validateQuestion(id: string, question: DecisionQuestion): void {
  if (question.type === 'choice') {
    const count = Object.keys(question.criteria).length;
    if (count < 1 || count > 255) {
      throw new JevDecisionError(`Choice question ${id} must contain 1-255 criteria.`);
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
  if (typeof value.error_type === 'string') return value.error_type;
  return undefined;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
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

/**
 * Thin adapter around TypeSafe's native System One endpoint.
 *
 * AX intentionally does not upgrade its existing AI SDK dependency just to use
 * Jev. The wire contract mirrors the official TypeSafe SDK: an API-root baseURL,
 * POST /v1/systemone, and AX boolean questions mapped to the `noul` primitive.
 */
export class JevDecisionEngine implements DecisionEngine {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseURL: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;

  constructor(options: JevDecisionEngineOptions) {
    const apiKey = options.apiKey.trim();
    if (!apiKey) throw new JevDecisionError('A TypeSafe API key is required.');
    this.apiKey = apiKey;
    this.model = options.model?.trim() || 'jev-latest';
    this.baseURL = (options.baseURL?.trim() || 'https://api.typesafe.ai').replace(/\/+$/, '');
    this.headers = { ...options.headers };
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async evaluate(request: DecisionEvaluationRequest): Promise<DecisionEvaluationResult> {
    const entries = Object.entries(request.questions);
    if (!entries.length) return { answers: {}, model: this.model };
    for (const [id, question] of entries) validateQuestion(id, question);

    const response = await this.fetchImpl(`${this.baseURL}/v1/systemone`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...this.headers,
      },
      body: JSON.stringify({
        model: this.model,
        state: request.state,
        questions: Object.fromEntries(entries.map(([id, question]) => [id, toWireQuestion(question)])),
      }),
      signal: request.signal,
    });

    const rawBody = await readJson(response);
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

    const answers: Record<string, DecisionAnswer> = {};
    for (const [id, question] of entries) {
      const rawAnswer = parsed.data.answers[id];
      if (!rawAnswer) throw new JevDecisionError(`TypeSafe response is missing answer ${id}.`);
      answers[id] = mapAnswer(id, question, rawAnswer);
    }

    return {
      answers,
      ...(parsed.data.model ? { model: parsed.data.model } : { model: this.model }),
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
