export type DecisionInstruction = string | Record<string, unknown>;

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
  evaluate(request: DecisionEvaluationRequest): Promise<DecisionEvaluationResult>;
}
