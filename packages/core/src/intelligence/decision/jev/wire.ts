import { z } from 'zod';
import type { DecisionAnswer, DecisionQuestion } from '../../../contracts/decision.js';
import { MAX_DECISION_CHOICE_CRITERIA } from '../../../contracts/decision.js';
import { JevDecisionError } from './errors.js';

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

type JevWireAnswer = z.infer<typeof JevAnswerSchema>;

export const JevResponseSchema = z.object({
  model: z.string().nullish(),
  answers: z.unknown(),
  usage: z.object({
    input_tokens: z.number().nullish(),
    output_tokens: z.number().nullish(),
  }).nullish(),
});

export function createRequestHeaders(apiKey: string, customHeaders: Record<string, string>): Headers {
  try {
    const headers = new Headers(customHeaders);
    headers.set('Authorization', `Bearer ${apiKey}`);
    headers.set('Accept', 'application/json');
    headers.set('Content-Type', 'application/json');
    return headers;
  } catch {
    throw new JevDecisionError(
      'TypeSafe request headers are invalid. Check the API key and custom headers, then try again.',
    );
  }
}

export function validateQuestion(id: string, question: DecisionQuestion): void {
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

export function toWireQuestion(question: DecisionQuestion): Record<string, unknown> {
  if (question.type === 'boolean') {
    return {
      type: 'noul',
      instructions: question.instructions,
      ...(question.criteria ? { criteria: question.criteria } : {}),
    };
  }
  return { ...question };
}

export function errorMessageFromBody(body: unknown): string | undefined {
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

export async function readJson(response: Response, maxBytes: number): Promise<unknown> {
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

export function mapAnswer(id: string, question: DecisionQuestion, raw: JevWireAnswer): DecisionAnswer {
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

export function parseAnswers(value: unknown): Map<string, JevWireAnswer> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new JevDecisionError('TypeSafe response did not match the expected Jev schema: answers must be an object.');
  }
  const answers = new Map<string, JevWireAnswer>();
  for (const [id, raw] of Object.entries(value)) {
    const parsed = JevAnswerSchema.safeParse(raw);
    if (!parsed.success) {
      throw new JevDecisionError(`TypeSafe response did not match the expected Jev schema: ${parsed.error.message}`);
    }
    answers.set(id, parsed.data);
  }
  return answers;
}
