import {
  DiscoveryInspectArgsSchema,
  type DiscoveryFieldReview,
  type DiscoveryInspectView,
} from '../schema.js';
import { canPublish, sourceIdFromExpr } from '../compile/blueprint.js';
import { formatMappingLabel, observationDisplay, progressLabel, displayValue } from '../view.js';
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
          : displayValue(entry.expected),
        actualDisplay: displayValue(entry.actual),
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
    ...(fieldReviews.some((review) => review.sourceId?.startsWith('input:'))
      ? { sourceNotice: UPLOADED_SOURCE_NOTICE }
      : {}),
  };
}

/**
 * An uploaded file is a fixed copy: a saved job reads that same copy every time. Said before
 * publishing so a monthly report is not silently recomputed from last month's data.
 */
export const UPLOADED_SOURCE_NOTICE = '대화에 올린 파일로 배운 업무입니다. 저장하면 실행할 때마다 이 파일을 다시 읽습니다. '
  + '매달 새 데이터로 만들려면 원본 파일이 들어오는 폴더를 연결하고 그 폴더의 파일로 다시 알려 주세요. 같은 이름 형식의 가장 최근 파일을 자동으로 읽습니다.';
