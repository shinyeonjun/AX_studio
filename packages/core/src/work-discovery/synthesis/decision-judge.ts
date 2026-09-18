import type { DecisionEngine, DecisionQuestion } from '../../contracts/decision.js';
import {
  boundDecisionString,
  DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
} from '../../intelligence/decision/context.js';
import { sourceIdFromExpr } from '../compile/blueprint.js';
import type { CandidateProgram, SourceDescriptor } from '../schema.js';

export const DISCOVERY_AUTO_RESOLVE_MIN_PROBABILITY = 0.9;
export const DISCOVERY_AUTO_RESOLVE_MIN_MARGIN = 0.2;
export const DISCOVERY_JEV_MAX_AMBIGUOUS_PATHS = 8;
export const DISCOVERY_JEV_MAX_CANDIDATES_PER_PATH = 32;
const DISCOVERY_JEV_MAX_VALUE_DEPTH = 8;
const DISCOVERY_JEV_MAX_ARRAY_ITEMS = 32;
const DISCOVERY_JEV_MAX_OBJECT_KEYS = 32;

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

function boundedValue(value: unknown, depth = 0): unknown {
  if (depth >= DISCOVERY_JEV_MAX_VALUE_DEPTH) return '[truncated]';
  if (typeof value === 'string') return boundDecisionString(value);
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(0, DISCOVERY_JEV_MAX_ARRAY_ITEMS).map((entry) => boundedValue(entry, depth + 1));
  }
  if (typeof value !== 'object') return String(value);
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, DISCOVERY_JEV_MAX_OBJECT_KEYS)
      .map(([key, entry]) => [boundDecisionString(key, 256), boundedValue(entry, depth + 1)]),
  );
}

function sourceContext(source: SourceDescriptor | undefined, sourceId: string | undefined): Record<string, unknown> {
  if (!source) return { id: boundDecisionString(sourceId ?? 'unknown', 256) };
  return {
    id: boundDecisionString(source.id, 256),
    label: boundDecisionString(source.label),
    connector: boundDecisionString(source.connector, 256),
    kind: source.kind,
    profileSummary: source.profileSummary ? boundDecisionString(source.profileSummary) : null,
  };
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
  const values: Array<{ option: string; probability: number }> = [];
  for (const option of validOptions) {
    const probability = probabilities[option];
    if (typeof probability !== 'number' || !Number.isFinite(probability) || probability < 0 || probability > 1) {
      return undefined;
    }
    values.push({ option, probability });
  }

  const selectedEntry = values.find((entry) => entry.option === selected);
  if (!selectedEntry) return undefined;
  const alternatives = values
    .filter((entry) => entry.option !== selected)
    .map((entry) => entry.probability)
    .sort((left, right) => right - left);
  const second = alternatives[0] ?? 0;
  return { selected: selectedEntry.probability, margin: selectedEntry.probability - second };
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

  for (const [pathIndex, outputPath] of input.ambiguousPaths
    .slice(0, DISCOVERY_JEV_MAX_AMBIGUOUS_PATHS)
    .entries()) {
    const candidates = acceptedCandidatesForPath(input.candidates, outputPath);
    if (candidates.length < 2 || candidates.length > DISCOVERY_JEV_MAX_CANDIDATES_PER_PATH) continue;

    const criteria: Record<string, Record<string, unknown>> = {};
    const optionToCandidateId = new Map<string, string>();
    for (const [candidateIndex, candidate] of candidates.entries()) {
      const option = `candidate_${candidateIndex}`;
      const sourceId = sourceIdFromExpr(candidate.expr);
      const source = sourceId ? sourceById.get(sourceId) : undefined;
      criteria[option] = {
        source: sourceContext(source, sourceId),
        expression: boundedValue(candidate.expr),
        replayScore: candidate.score,
      };
      optionToCandidateId.set(option, candidate.id);
    }

    const questionId = `ambiguity_${pathIndex}`;
    questions[questionId] = {
      type: 'choice',
      instructions: {
        task: 'Choose the mapping that most likely reflects the user intended semantics. Every option has already reproduced the observed examples exactly.',
        outputPath: boundDecisionString(outputPath),
        dataPolicy: DECISION_CONTEXT_UNTRUSTED_DATA_POLICY,
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
        userGoal: boundDecisionString(input.userGoal),
        rule: 'Only disambiguate intent between mappings that already passed deterministic replay. Prefer human clarification when uncertain.',
        purpose: 'work_discovery_replay_ambiguity',
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
