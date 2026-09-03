import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { DiscoverySessionState } from '../schema.js';
import { buildClarificationQuestion } from '../clarification/question.js';
import { buildDiscoveryBlueprint } from '../compile/blueprint.js';
import { enumerateCandidates, replayCandidates, resolveReplayWinners } from '../synthesis/index.js';
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

export function completeDiscoveryReplay(context: DiscoveryReplayContext): void {
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
  const { candidates: replayed, ambiguousPaths } = resolveReplayWinners(replayedRaw, requiredPaths);

  persistReplayCases(host, sessionId, examples, observations, replayed);

  if (state.status === 'synthesizing') state = host.transition(state, 'validating');
  const accepted = replayed.filter((candidate) => candidate.status === 'accepted');
  const question = ambiguousPaths.length > 0
    ? buildClarificationQuestion({ sessionId, candidates: replayed })
    : undefined;
  const coveredPaths = new Set(accepted.map((candidate) => candidate.observationPath));
  const allRequiredCovered = requiredPaths.every((path) => coveredPaths.has(path));
  const nextStatus = accepted.length === 0 || !allRequiredCovered
    ? 'failed'
    : question
      ? 'needs_clarification'
      : 'ready_to_publish';
  const blueprint = accepted.length > 0 && !question && allRequiredCovered
    ? buildDiscoveryBlueprint({ ...state, candidates: replayed })
    : undefined;

  host.patchState(sessionId, {
    candidates: replayed,
    pendingQuestion: question,
    blueprint,
    budgets: {
      ...state.budgets,
      elapsedMs: Date.now() - startedAt,
    },
    status: nextStatus,
    errorCode: accepted.length > 0 && allRequiredCovered ? undefined : 'no_matching_candidate',
    errorMessage: accepted.length > 0 && allRequiredCovered
      ? undefined
      : 'Required output fields could not be replayed across every example.',
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
