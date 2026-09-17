import type { DecisionEngine, DecisionQuestion } from '../../contracts/decision.js';
import { sourceIdFromExpr } from '../compile/blueprint.js';
import type { CandidateProgram, SourceDescriptor } from '../schema.js';

export const DISCOVERY_AUTO_RESOLVE_MIN_PROBABILITY = 0.9;
export const DISCOVERY_AUTO_RESOLVE_MIN_MARGIN = 0.2;

export interface ReplayAmbiguityDecisionInput {
  decisionEngine?: DecisionEngine;
  userGoal: string;
  candidates: CandidateProgram[];
  ambiguousPaths: string[];
  sourceInventory: SourceDescriptor[];
}

export interface ReplayAmbiguityDecisionResult {
  candidates: CandidateProgram[];
  remainingAmbiguousPaths: string[];
  autoResolvedPaths: string[];
}

interface QuestionBinding {
  outputPath: string;
  optionToCandidateId: Map<string, string>;
}

function acceptedCandidatesForPath(candidates: CandidateProgram[], outputPath: string): CandidateProgram[] {
  return candidates.filter((candidate) =>
    candidate.observationPath === outputPath && candidate.status === 'accepted',
  );
}

function selectedProbability(
  probabilities: Record<string, number>,
  selected: string,
  validOptions: ReadonlySet<string>,
): { selected: number; margin: number } | undefined {
  const probability = probabilities[selected];
  if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
    return undefined;
  }

  const alternatives = Object.entries(probabilities)
    .filter(([option, value]) => option !== selected && validOptions.has(option) && Number.isFinite(value))
    .map(([, value]) => value)
    .sort((left, right) => right - left);
  const second = alternatives[0] ?? 0;
  return { selected: probability, margin: probability - second };
}

/**
 * Uses the decision plane only after deterministic replay has produced multiple
 * passing mappings for the same required output path.
 *
 * Auto-resolution is deliberately conservative. If the provider fails, returns
 * an invalid option, or does not clear both probability thresholds, the existing
 * human clarification path remains unchanged.
 */
export async function judgeReplayAmbiguity(
  input: ReplayAmbiguityDecisionInput,
): Promise<ReplayAmbiguityDecisionResult> {
  if (!input.decisionEngine || input.ambiguousPaths.length === 0) {
    return {
      candidates: input.candidates,
      remainingAmbiguousPaths: [...input.ambiguousPaths],
      autoResolvedPaths: [],
    };
  }

  const sourceById = new Map(input.sourceInventory.map((source) => [source.id, source]));
  const questions: Record<string, DecisionQuestion> = {};
  const bindings = new Map<string, QuestionBinding>();

  for (const [pathIndex, outputPath] of input.ambiguousPaths.entries()) {
    const candidates = acceptedCandidatesForPath(input.candidates, outputPath);
    if (candidates.length < 2 || candidates.length > 255) continue;

    const criteria: Record<string, Record<string, unknown>> = {};
    const optionToCandidateId = new Map<string, string>();
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const option = `candidate_${candidateIndex}`;
      const sourceId = sourceIdFromExpr(candidate.expr);
      const source = sourceId ? sourceById.get(sourceId) : undefined;
      criteria[option] = {
        source: source
          ? {
              id: source.id,
              label: source.label,
              connector: source.connector,
              kind: source.kind,
              profileSummary: source.profileSummary ?? null,
            }
          : { id: sourceId ?? 'unknown' },
        expression: candidate.expr,
        replayScore: candidate.score,
      };
      optionToCandidateId.set(option, candidate.id);
    }

    const questionId = `ambiguity_${pathIndex}`;
    questions[questionId] = {
      type: 'choice',
      instructions: {
        task: 'Choose the mapping that most likely reflects the user intended semantics. Every option has already reproduced the observed examples exactly.',
        outputPath,
      },
      criteria,
    };
    bindings.set(questionId, { outputPath, optionToCandidateId });
  }

  if (Object.keys(questions).length === 0) {
    return {
      candidates: input.candidates,
      remainingAmbiguousPaths: [...input.ambiguousPaths],
      autoResolvedPaths: [],
    };
  }

  try {
    const result = await input.decisionEngine.evaluate({
      state: {
        userGoal: input.userGoal,
        rule: 'Only disambiguate intent between mappings that already passed deterministic replay. Prefer human clarification when uncertain.',
      },
      questions,
    });

    const selectedByPath = new Map<string, string>();
    for (const [questionId, binding] of bindings) {
      const answer = result.answers[questionId];
      if (!answer || answer.type !== 'choice') continue;
      const candidateId = binding.optionToCandidateId.get(answer.choice);
      if (!candidateId) continue;
      const confidence = selectedProbability(
        answer.probabilities,
        answer.choice,
        new Set(binding.optionToCandidateId.keys()),
      );
      if (!confidence) continue;
      if (confidence.selected < DISCOVERY_AUTO_RESOLVE_MIN_PROBABILITY) continue;
      if (confidence.margin < DISCOVERY_AUTO_RESOLVE_MIN_MARGIN) continue;
      selectedByPath.set(binding.outputPath, candidateId);
    }

    if (selectedByPath.size === 0) {
      return {
        candidates: input.candidates,
        remainingAmbiguousPaths: [...input.ambiguousPaths],
        autoResolvedPaths: [],
      };
    }

    const candidates = input.candidates.map((candidate) => {
      const selectedId = selectedByPath.get(candidate.observationPath);
      if (!selectedId || candidate.status !== 'accepted') return candidate;
      return {
        ...candidate,
        status: candidate.id === selectedId ? 'accepted' as const : 'rejected' as const,
      };
    });
    const autoResolvedPaths = input.ambiguousPaths.filter((path) => selectedByPath.has(path));
    const remainingAmbiguousPaths = input.ambiguousPaths.filter((path) => !selectedByPath.has(path));

    return { candidates, remainingAmbiguousPaths, autoResolvedPaths };
  } catch {
    return {
      candidates: input.candidates,
      remainingAmbiguousPaths: [...input.ambiguousPaths],
      autoResolvedPaths: [],
    };
  }
}
