import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { DiscoverySessionState } from '../schema.js';
import { buildClarificationQuestion, buildConfirmationQuestion } from '../clarification/question.js';
import { buildDiscoveryBlueprint, needsHumanConfirmation } from '../compile/blueprint.js';
import { DiscoveryRecoverableError } from '../recovery/error.js';
import { enumerateCandidates, replayCandidates, resolveReplayWinners } from '../synthesis/index.js';
import { judgeReplayAmbiguity } from '../synthesis/decision-judge.js';
import { inputPairings, type InputPairing } from '../synthesis/input-pairing.js';
import { writeSnapshotTable } from '../snapshot-file.js';
import { join } from 'node:path';
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

/**
 * Saves the pairing as snapshots: each paired example gets its own file's table under the shared
 * id. Resuming from the checkpoint and replaying a repair against history then read the same
 * pairing the rule was learned with, instead of the first example's file for every example.
 */
function persistInputBindings(host: DiscoveryPipelineHost, sessionId: string, pairing: InputPairing): void {
  if (pairing.bindings.length === 0) return;
  const records = host.store.listDiscoverySnapshots(sessionId);
  for (const binding of pairing.bindings) {
    const source = records.find((record) => record.exampleId === binding.exampleId && record.sourceId === binding.sourceId);
    const table = pairing.snapshotsByExample[binding.exampleId]?.[binding.sharedId];
    if (!source || !table) continue;
    host.store.upsertDiscoverySnapshot({
      ...source,
      id: host.snapshotRecordId(sessionId, binding.exampleId, binding.sharedId),
      sourceId: binding.sharedId,
      manifestPath: writeSnapshotTable(join(host.snapshotDir, sessionId), binding.exampleId, binding.sharedId, table, source.fingerprint),
      capturedAt: new Date().toISOString(),
    });
  }
}

/** Required fields some candidate reproduces in every example. */
function coveredPathCount(candidates: ReturnType<typeof replayCandidates>, requiredPaths: readonly string[]): number {
  const covered = new Set(candidates
    .filter((candidate) => candidate.replayResults.length > 0 && candidate.replayResults.every((entry) => entry.pass))
    .map((candidate) => candidate.observationPath));
  return requiredPaths.filter((path) => covered.has(path)).length;
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
  const requiredPaths = [...new Set(observations.filter((entry) => entry.required).map((entry) => entry.path))];
  const replayExamples = examples.map((example) => ({
    exampleId: example.id,
    observations: observations.filter((entry) => entry.exampleId === example.id),
  }));
  // Each example may need its own period's file; replay every plausible pairing and keep the one
  // that explains the most required fields (the earliest, i.e. most preferred, on a tie).
  const pairings = inputPairings({
    examples: examples.map((example) => ({
      id: example.id,
      outputNames: example.outputArtifactIds.flatMap((artifactId) => host.artifactStore.get(artifactId)?.fileName ?? []),
    })),
    sources: sourceInventory,
    snapshotsByExample,
  });
  let best: { replayedRaw: ReturnType<typeof replayCandidates>; covered: number; pairing: InputPairing } | undefined;
  for (const pairing of pairings) {
    const pairedSnapshots = pairing.snapshotsByExample;
    const enumerated = enumerateCandidates(
      observations,
      sourceInventory,
      pairedSnapshots[examples[0]?.id ?? ''] ?? {},
    );
    const replayedRaw = replayCandidates({ candidates: enumerated, examples: replayExamples, snapshotsByExample: pairedSnapshots });
    const covered = coveredPathCount(replayedRaw, requiredPaths);
    if (!best || covered > best.covered) best = { replayedRaw, covered, pairing };
    if (covered === requiredPaths.length) break;
  }
  const replayedRaw = best?.replayedRaw ?? [];
  if (best) persistInputBindings(host, sessionId, best.pairing);
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
