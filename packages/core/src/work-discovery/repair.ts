import type { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { RepairCandidateOperation, RepairReplayCase, RepairReplaySummary } from '../workflow/repair.js';
import { parseExpectedObservations, replayOneCase } from './repair/case.js';
import { loadSnapshots, sessionIdForWorkflow } from './repair/history.js';
import type { RepairReplayOptions } from './repair/contracts.js';
export type { RepairReplayOptions } from './repair/contracts.js';
/** Replays one repair candidate against every persisted Work Discovery case. */
export function replayRepairCandidate(
  store: WorkflowStore,
  workflow: WorkflowIR,
  candidate: RepairCandidateOperation,
  options: RepairReplayOptions,
): RepairReplaySummary {
  const sessionId = sessionIdForWorkflow(workflow);
  if (!sessionId) {
    return {
      status: 'unavailable',
      total: 0,
      passed: 0,
      failed: 0,
      cases: [],
      reason: 'historical_session_unavailable',
    };
  }
  const cases = store.listDiscoveryReplayCases(sessionId);
  if (cases.length === 0) {
    return {
      status: 'unavailable',
      total: 0,
      passed: 0,
      failed: 0,
      cases: [],
      reason: 'historical_replay_unavailable',
    };
  }
  const replayCases: RepairReplayCase[] = [];
  for (const replayCase of cases) {
    const observations = parseExpectedObservations(replayCase.expectedObservationsJson);
    if (!observations) {
      return {
        status: 'unavailable',
        total: 0,
        passed: 0,
        failed: 0,
        cases: [],
        reason: 'historical_replay_case_invalid',
      };
    }
    const loaded = loadSnapshots(store, sessionId, replayCase.exampleId, options.snapshotRoot);
    if (!loaded.ok) {
      return {
        status: 'unavailable',
        total: 0,
        passed: 0,
        failed: 0,
        cases: [],
        reason: loaded.reason,
      };
    }
    replayCases.push(replayOneCase(
      workflow,
      candidate,
      observations,
      loaded.snapshots,
      replayCase.id,
      replayCase.exampleId,
    ));
  }
  const passed = replayCases.filter((entry) => entry.pass).length;
  const failed = replayCases.length - passed;
  return {
    status: failed === 0 ? 'passed' : 'failed',
    total: replayCases.length,
    passed,
    failed,
    cases: replayCases,
  };
}
