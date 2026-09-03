import {
  DiscoveryInspectArgsSchema,
  type DiscoveryFieldReview,
  type DiscoveryInspectView,
} from '../schema.js';
import { canPublish, sourceIdFromExpr } from '../compile/blueprint.js';
import { formatMappingLabel, observationDisplay, progressLabel } from '../view.js';
import { SUPPORTED_OUTPUT_FORMATS } from '../observation/observe-artifact.js';
import type { WorkDiscoveryRuntime } from './contracts.js';

export function inspectDiscovery(
  runtime: WorkDiscoveryRuntime,
  sessionId: string,
): DiscoveryInspectView | undefined {
  const parsed = DiscoveryInspectArgsSchema.parse({ sessionId });
  const state = runtime.store.getDiscoverySessionState(parsed.sessionId);
  if (!state) return undefined;

  const accepted = state.candidates.filter((candidate) => candidate.status === 'accepted');
  const fieldReviews: DiscoveryFieldReview[] = [];
  const paths = [...new Set(state.observations.filter((entry) => entry.required).map((entry) => entry.path))];
  for (const path of paths) {
    const observation = state.observations.find((entry) => entry.path === path);
    const winner = accepted.find((candidate) => candidate.observationPath === path);
    fieldReviews.push({
      outputPath: path,
      label: observation?.label,
      display: observation ? observationDisplay(observation) : undefined,
      sourceId: winner ? sourceIdFromExpr(winner.expr) : undefined,
      mappingLabel: winner ? formatMappingLabel(winner) : undefined,
      confidence: winner?.score.replay,
      replayByExample: winner?.replayResults.map((entry) => ({
        exampleId: entry.exampleId,
        expectedDisplay: typeof entry.expected === 'object' && entry.expected && 'value' in (entry.expected as object)
          ? String((entry.expected as { value?: unknown }).value ?? '')
          : String(entry.expected ?? ''),
        actualDisplay: String(entry.actual ?? ''),
        pass: entry.pass,
        match: entry.match,
      })) ?? [],
    });
  }

  return {
    sessionId: state.id,
    status: state.status,
    revision: state.revision,
    recoveryCheckpoint: state.recoveryCheckpoint,
    autoRecoveryAttempts: state.autoRecoveryAttempts,
    progress: progressLabel(state.status),
    publishable: canPublish(state).ok,
    pendingQuestion: state.pendingQuestion,
    observations: state.observations.map((observation) => ({
      path: observation.path,
      label: observation.label,
      display: observationDisplay(observation),
    })),
    fieldReviews,
    replaySummary: {
      total: state.candidates.length,
      passed: accepted.length,
      failed: Math.max(0, state.candidates.length - accepted.length),
    },
    workflowId: state.publishedWorkflowId,
    errorCode: state.errorCode,
    errorMessage: state.errorMessage,
    supportedOutputFormats: [...SUPPORTED_OUTPUT_FORMATS],
  };
}
