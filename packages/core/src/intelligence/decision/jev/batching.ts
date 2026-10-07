import type { DecisionEvaluationResult, DecisionQuestion } from '../../../contracts/decision.js';
import { JevDecisionError } from './errors.js';

export interface JevRequestBatch {
  entries: Array<[string, DecisionQuestion]>;
  body: string;
  bytes: number;
}

/**
 * Splits an oversized serialized request into byte-bounded batches. Every batch
 * repeats the shared state; a single question that cannot fit alone is rejected.
 */
export function splitJevRequest(
  body: string,
  entries: Array<[string, DecisionQuestion]>,
  maxRequestBytes: number,
): JevRequestBatch[] {
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
  if (baseBytes > maxRequestBytes) throw new JevDecisionError('TypeSafe request is too large.');

  const wireEntries = Object.entries(wireRequest.questions);
  const batches: JevRequestBatch[] = [];
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
    if (baseBytes + entryBytes > maxRequestBytes) {
      throw new JevDecisionError('TypeSafe request is too large.');
    }
    const separatorBytes = batchEntries.length ? 1 : 0;
    if (batchBytes + separatorBytes + entryBytes > maxRequestBytes) finishBatch();
    batchEntries.push([id, question]);
    batchWireEntries.push(wireEntry);
    batchBytes += (batchEntries.length > 1 ? 1 : 0) + entryBytes;
  }
  if (batchEntries.length) finishBatch();
  return batches;
}

/** Usage totals are reported only when every batch reported that counter. */
export function mergeBatchResults(results: readonly DecisionEvaluationResult[], model: string): DecisionEvaluationResult {
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
    model: results[0]?.model ?? model,
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
}
