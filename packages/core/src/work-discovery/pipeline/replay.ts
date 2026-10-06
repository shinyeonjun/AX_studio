import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { DiscoverySessionState } from '../schema.js';
import { buildClarificationQuestion, buildConfirmationQuestion } from '../clarification/question.js';
import { buildDiscoveryBlueprint, needsHumanConfirmation } from '../compile/blueprint.js';
import { DiscoveryRecoverableError } from '../recovery/error.js';
import { enumerateCandidates, replayCandidates, resolveReplayWinners } from '../synthesis/index.js';
import { judgeReplayAmbiguity } from '../synthesis/decision-judge.js';
import type { DiscoveryPipelineExample, DiscoveryPipelineHost } from './contracts.js';

export interface DiscoveryReplayContext {
  readonly host: DiscoveryPipelineHost;
  readonly sessionId: string;
  readonly examples: DiscoveryPipelineExample[];
  readonly state: DiscoverySessionState;
  readonly observations: OutputObservation[];
  readonly sourceInventory: DiscoverySessionState['sourceInventory'];
  readonly snapshotsByExample: Record<string, Record<string, TableArtifact>>;
  readonly startedAt: number;
}

export async function completeDiscoveryReplay(context: DiscoveryReplayContext): Promise<void> {
  const {
    host,
    sessionId,
    examples,
    observations,
    sourceInventory,
    snapshotsByExample,
    startedAt,
  } = context;
  let state = context.state;
  const enumerated = enumerateCandidates(
    observations,
    sourceInventory,
    snapshotsByExample[examples[0]?.id ?? ''] ?? {},
  );
  const replayedRaw = replayCandidates({
    candidates: enumerated,
    examples: examples.map((example) => ({
      exampleId: example.id,
      observations: observations.filter((entry) => entry.exampleId === example.id),
    })),
    snapshotsByExample,
  });
  const requiredPaths = [...new Set(observations.filter((entry) => entry.required).map((entry) => entry.path))];
  const replayResolution = resolveReplayWinners(replayedRaw, requiredPaths);

  if (host.isCancelled(sessionId)) return;
  const judged = await judgeReplayAmbiguity({
    decisionEngine: host.decisionEngine,
    userGoal: state.userGoal,
    candidates: replayResolution.candidates,
    ambiguousPaths: replayResolution.ambiguousPaths,
    sourceInventory,
  });
  if (host.isCancelled(sessionId)) return;
  const replayed = judged.candidates;

  persistReplayCases(host, sessionId, examples, observations, replayed);

  if (state.status === 'synthesizing') state = host.transition(state, 'validating');
  const accepted = replayed.filter((candidate) => candidate.status === 'accepted');
  const coveredPaths = new Set(accepted.map((candidate) => candidate.observationPath));
  const allRequiredCovered = requiredPaths.every((path) => coveredPaths.has(path));
  const elapsedMs = Date.now() - startedAt;

  if (accepted.length === 0 || !allRequiredCovered) {
    // Name the fields so the user knows what to clarify (shown as-is in the review card).
    const missing = requiredPaths.filter((path) => !coveredPaths.has(path))
      .map((path) => observations.find((entry) => entry.path === path)?.label ?? path);
    const errorMessage = missing.length > 0
      ? `다음 항목을 계산하는 방법을 찾지 못했습니다: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ` 외 ${missing.length - 5}개` : ''}. 예시를 하나 더 추가하거나 이 항목이 어떻게 계산되는지 알려주세요.`
      : '결과물의 항목을 데이터로 재현하는 방법을 찾지 못했습니다. 예시를 하나 더 추가해 주세요.';
    host.patchState(sessionId, {
      candidates: replayed,
      pendingQuestion: undefined,
      blueprint: undefined,
      budgets: {
        ...state.budgets,
        elapsedMs,
      },
      errorCode: 'no_matching_candidate',
      errorMessage,
    });
    throw new DiscoveryRecoverableError('no_matching_candidate', errorMessage);
  }

  // Too few examples cannot establish the rule on their own; ask a person to confirm.
  const question = judged.remainingAmbiguousPaths.length > 0
    ? buildClarificationQuestion({ sessionId, candidates: replayed })
    : needsHumanConfirmation({ ...state, observations })
      ? buildConfirmationQuestion({ sessionId, candidates: replayed })
      : undefined;
  const nextStatus = question ? 'needs_clarification' : 'ready_to_publish';
  const blueprint = !question
    ? buildDiscoveryBlueprint({ ...state, candidates: replayed })
    : undefined;

  host.patchState(sessionId, {
    candidates: replayed,
    pendingQuestion: question,
    blueprint,
    budgets: {
      ...state.budgets,
      elapsedMs,
    },
    status: nextStatus,
    errorCode: undefined,
    errorMessage: undefined,
  });
}

function persistReplayCases(
  host: DiscoveryPipelineHost,
  sessionId: string,
  examples: DiscoveryPipelineExample[],
  observations: OutputObservation[],
  replayed: ReturnType<typeof resolveReplayWinners>['candidates'],
): void {
  for (const example of examples) {
    const exampleObservations = observations.filter((entry) => entry.exampleId === example.id);
    const exampleResults = replayed.map((candidate) => ({
      candidateId: candidate.id,
      observationPath: candidate.observationPath,
      result: candidate.replayResults.find((entry) => entry.exampleId === example.id),
    }));
    host.store.upsertDiscoveryReplayCase({
      id: `replay_${sessionId}_${example.id}`,
      sessionId,
      exampleId: example.id,
      snapshotSetId: `snapshot_set_${sessionId}_${example.id}`,
      expectedObservationsJson: JSON.stringify(exampleObservations),
      lastResultJson: JSON.stringify(exampleResults),
      createdAt: new Date().toISOString(),
    });
  }
}
