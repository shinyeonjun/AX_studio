import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../../../model/provider.js';
import type { DecisionAnswer, DecisionEvaluationRequest } from '../../../../../contracts/decision.js';

export interface ParallelToolCandidateForTest {
  id: string;
  kind: 'read' | 'write';
  capabilityId?: string;
  capability_id?: string;
  connector?: string;
  label?: string;
  description?: string;
}

export function parallelToolCandidateForTest(
  question: DecisionEvaluationRequest['questions'][string] | undefined,
): ParallelToolCandidateForTest | undefined {
  if (question?.type !== 'boolean' || typeof question.instructions !== 'object'
    || question.instructions === null || Array.isArray(question.instructions)) return undefined;
  const candidate = question.instructions.candidate;
  return candidate && typeof candidate === 'object' && 'id' in candidate && typeof candidate.id === 'string'
    && 'kind' in candidate && (candidate.kind === 'read' || candidate.kind === 'write')
    ? {
        ...candidate as ParallelToolCandidateForTest,
        capabilityId: (candidate as ParallelToolCandidateForTest).capabilityId
          ?? (candidate as ParallelToolCandidateForTest).capability_id,
      }
    : undefined;
}

export function parallelToolQuestionIdForTest(
  request: DecisionEvaluationRequest,
  matches: (candidate: ParallelToolCandidateForTest) => boolean,
): string | undefined {
  return Object.entries(request.questions).find(([id, question]) => {
    if (!id.startsWith('tool_')) return false;
    const candidate = parallelToolCandidateForTest(question);
    return candidate ? matches(candidate) : false;
  })?.[0];
}

export function parallelToolAnswersForTest(
  request: DecisionEvaluationRequest,
  input: {
    needsNaturalLanguageAnswer: boolean;
    select?: (candidate: ParallelToolCandidateForTest) => boolean;
    selectedProbability?: number;
  },
): Record<string, DecisionAnswer> {
  if (request.questions.requirements && request.questions.scope) return {
    requirements: { type: 'choice', choice: 'met', probabilities: { met: 1 } },
    scope: { type: 'choice', choice: 'preserved', probabilities: { preserved: 1 } },
  };
  const answers: Record<string, DecisionAnswer> = {
    needs_natural_language_answer: {
      type: 'boolean',
      probability: input.needsNaturalLanguageAnswer ? 0.99 : 0.01,
    },
  };
  for (const [id, question] of Object.entries(request.questions)) {
    if (!id.startsWith('tool_')) continue;
    const candidate = parallelToolCandidateForTest(question);
    const selected = candidate ? input.select?.(candidate) === true : false;
    answers[id] = { type: 'boolean', probability: selected ? input.selectedProbability ?? 0.99 : 0.01 };
  }
  return answers;
}

export function scriptedModel(
  outputs: unknown[],
  seen: StructuredGenerateInput<unknown>[],
  name = 'test-provider',
  textOutputs: string[] = [],
  textSeen: TextGenerateInput[] = [],
): ModelProvider {
  return {
    name,
    async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
      seen.push(input as StructuredGenerateInput<unknown>);
      const next = outputs.shift();
      if (next === undefined) throw new Error('test_model_script_exhausted');
      return next as T;
    },
    async generateText(input: TextGenerateInput): Promise<string> {
      textSeen.push(input);
      const next = textOutputs.shift();
      if (next === undefined) throw new Error('text_generation_not_scripted');
      return next;
    },
  };
}
