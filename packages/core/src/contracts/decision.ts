export type DecisionInstruction = string | Record<string, unknown>;

/** Shared decision-wire ceiling: Jev accepts at most 255 criteria per choice. */
export const MAX_DECISION_CHOICE_CRITERIA = 255;

export function decisionChoiceValues(value: unknown): Array<string | number> | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const options = [...new Set(value)];
  if (options.length > MAX_DECISION_CHOICE_CRITERIA) return undefined;
  if (options.every((option): option is string => typeof option === 'string' && option.length <= 256)) return options;
  return options.every((option): option is number => typeof option === 'number' && Number.isFinite(option))
    ? options
    : undefined;
}

export type DecisionOutputRoute =
  | { kind: 'boolean' }
  | { kind: 'choice'; options: Array<string | number> }
  | { kind: 'constant'; value: string | number }
  | { kind: 'model' }
  | { kind: 'unsupported' };

/** Shared by runtime routing and workflow validation so output roles cannot drift. */
export function classifyDecisionOutput(value: unknown): DecisionOutputRoute {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { kind: 'model' };
  const schema = value as Record<string, unknown>;
  if (schema.type === 'boolean') {
    if (!Object.hasOwn(schema, 'enum')) return { kind: 'boolean' };
    return Array.isArray(schema.enum)
      && schema.enum.length === 2
      && new Set(schema.enum).size === 2
      && schema.enum.every((option) => typeof option === 'boolean')
      ? { kind: 'boolean' }
      : { kind: 'unsupported' };
  }
  if (!Object.hasOwn(schema, 'enum')) return { kind: 'model' };

  const options = decisionChoiceValues(schema.enum);
  if (!options) return { kind: 'unsupported' };
  const matchesType = schema.type === undefined
    || (schema.type === 'string' && options.every((option) => typeof option === 'string'))
    || (schema.type === 'number' && options.every((option) => typeof option === 'number'))
    || (schema.type === 'integer' && options.every((option) => typeof option === 'number' && Number.isInteger(option)));
  if (!matchesType) return { kind: 'unsupported' };
  return options.length === 1 ? { kind: 'constant', value: options[0]! } : { kind: 'choice', options };
}

export interface BooleanDecisionQuestion {
  type: 'boolean';
  instructions: DecisionInstruction;
}

export interface ChoiceDecisionQuestion {
  type: 'choice';
  instructions: DecisionInstruction;
  criteria: Record<string, DecisionInstruction>;
}

export interface ScoreDecisionQuestion {
  type: 'score';
  instructions: DecisionInstruction;
  criteria: readonly DecisionInstruction[];
}

export type DecisionQuestion = BooleanDecisionQuestion | ChoiceDecisionQuestion | ScoreDecisionQuestion;

export interface BooleanDecisionAnswer {
  type: 'boolean';
  probability: number;
}

export interface ChoiceDecisionAnswer {
  type: 'choice';
  choice: string;
  probabilities: Record<string, number>;
  confidence?: number;
}

export interface ScoreDecisionAnswer {
  type: 'score';
  score: number;
  probabilities: Record<string, number>;
  confidence?: number;
}

export type DecisionAnswer = BooleanDecisionAnswer | ChoiceDecisionAnswer | ScoreDecisionAnswer;

export interface DecisionEvaluationRequest {
  state: unknown;
  questions: Record<string, DecisionQuestion>;
  signal?: AbortSignal;
}

export interface DecisionEvaluationResult {
  answers: Record<string, DecisionAnswer>;
  model?: string;
  /** Provider HTTP requests used for this evaluation; defaults to one for adapters without internal batching. */
  providerRequestCount?: number;
  /** UTF-8 bytes sent across provider request bodies, including repeated batch context. */
  requestBytes?: number;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
  };
}

/**
 * Narrow probabilistic decision boundary used by AX policy/orchestration code.
 * Implementations may call a hosted model, a local model, or deterministic code.
 */
export interface DecisionEngine {
  /** Where evaluations run; unspecified adapters are treated as cloud for data-policy checks. */
  readonly dataHandling?: 'cloud' | 'local';
  evaluate(request: DecisionEvaluationRequest): Promise<DecisionEvaluationResult>;
}

export function decisionProviderRequestCountFromError(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('providerRequestCount' in error)) return undefined;
  const count = error.providerRequestCount;
  return typeof count === 'number' && Number.isSafeInteger(count) && count >= 0 ? count : undefined;
}

export function decisionProviderRequestBytesFromError(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('requestBytes' in error)) return undefined;
  const bytes = error.requestBytes;
  return typeof bytes === 'number' && Number.isSafeInteger(bytes) && bytes >= 0 ? bytes : undefined;
}
