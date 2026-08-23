import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowStore } from '../store/workflow-store.js';
import { ArtifactStore } from '../store/artifact-store.js';
import { getAxDataPaths } from '../paths/ax-data.js';
import type { TableArtifact } from '../contracts/artifacts/table.js';
import { applyClarificationAnswer } from './clarification/answer-apply.js';
import { buildClarificationQuestion } from './clarification/question.js';
import { buildDiscoveryBlueprint, canPublish, sourceIdFromExpr } from './compile/blueprint.js';
import { compileBlueprintToWorkflow } from './compile/compile-workflow.js';
import { inventorySources } from './exploration/inventory.js';
import { observeArtifact, SUPPORTED_OUTPUT_FORMATS } from './observation/observe-artifact.js';
import type { OutputObservation } from './observation/schema.js';
import {
  DiscoveryCancelArgsSchema,
  DiscoveryInspectArgsSchema,
  DiscoveryStartArgsSchema,
  type DiscoveryFieldReview,
  type DiscoveryInspectView,
  type DiscoverySessionState,
  type DiscoveryStartArgs,
} from './schema.js';
import { assertTransition, isTerminalStatus } from './state-machine.js';
import { enumerateCandidates, replayCandidates, resolveReplayWinners } from './synthesis/index.js';
import { createDefaultDiscoverySourceRegistry } from './sources/index.js';
import type { DiscoverySourceRegistry } from './sources/registry.js';

export interface WorkDiscoveryServiceOptions {
  store: WorkflowStore;
  artifactStore?: ArtifactStore;
  snapshotDir?: string;
  sourceRegistry?: DiscoverySourceRegistry;
  sourceReadsMax?: number;
}

function observationDisplay(observation: OutputObservation): string {
  if (observation.value.kind === 'number') {
    return observation.value.display ?? String(observation.value.value);
  }
  if (observation.value.kind === 'text') return observation.value.value;
  return JSON.stringify(observation.value);
}

function formatMappingLabel(candidate: { expr: { op: string; fn?: string; column?: string; name?: string } }): string {
  if (candidate.expr.op === 'aggregate') {
    return `${candidate.expr.fn?.toUpperCase() ?? 'AGG'}(${candidate.expr.column ?? 'rows'})`;
  }
  if (candidate.expr.op === 'ratio') return 'RATIO(%)';
  if (candidate.expr.op === 'column') return `COLUMN(${candidate.expr.name})`;
  return candidate.expr.op;
}

function progressLabel(status: DiscoverySessionState['status']): string {
  switch (status) {
    case 'collecting_examples':
      return '예시를 모으는 중';
    case 'observing_output':
      return '결과물에서 항목을 찾는 중';
    case 'inventory_sources':
    case 'exploring_sources':
      return '연결된 자료를 찾아보는 중';
    case 'synthesizing':
    case 'validating':
      return '만드는 방법을 재현하는 중';
    case 'needs_clarification':
      return '확인이 필요함';
    case 'ready_to_publish':
      return '맡길 수 있음';
    case 'published':
      return '업무로 저장됨';
    case 'cancelled':
      return '취소됨';
    case 'failed':
      return '실패';
    default:
      return status;
  }
}

export class WorkDiscoveryService {
  private readonly running = new Set<string>();
  private readonly artifactStore: ArtifactStore;
  private readonly snapshotDir: string;
  private readonly sourceRegistry: DiscoverySourceRegistry;
  private readonly sourceReadsMax: number;

  constructor(private readonly options: WorkDiscoveryServiceOptions) {
    const paths = getAxDataPaths();
    this.artifactStore = options.artifactStore ?? new ArtifactStore(join(paths.root, 'artifacts'));
    this.snapshotDir = options.snapshotDir ?? join(paths.root, 'discovery', 'snapshots');
    mkdirSync(this.snapshotDir, { recursive: true });
    this.sourceRegistry = options.sourceRegistry ?? createDefaultDiscoverySourceRegistry(options.store, this.artifactStore);
    this.sourceReadsMax = options.sourceReadsMax ?? 12;
  }

  start(args: DiscoveryStartArgs): { id: string; state: DiscoverySessionState['status'] } {
    const parsed = DiscoveryStartArgsSchema.parse(args);
    const now = new Date().toISOString();
    const sessionId = `wd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const exampleIds: string[] = [];
    const sessionInputArtifactIds = parsed.inputArtifactIds ?? [];

    const state: DiscoverySessionState = {
      id: sessionId,
      status: 'collecting_examples',
      revision: 0,
      userGoal: parsed.goal,
      exampleIds,
      sourceInventory: [],
      observations: [],
      candidates: [],
      budgets: {
        sourceReadsUsed: 0,
        sourceReadsMax: this.sourceReadsMax,
        modelCallsUsed: 0,
        modelCallsMax: 4,
        elapsedMs: 0,
      },
      createdAt: now,
      updatedAt: now,
    };

    this.options.store.saveDiscoverySession(state);

    for (const [index, artifactId] of parsed.exampleArtifactIds.entries()) {
      const example = this.options.store.insertDiscoveryExample({
        sessionId,
        label: `example_${index + 1}`,
        outputArtifactIds: [artifactId],
        inputArtifactIds: sessionInputArtifactIds,
      });
      exampleIds.push(example.id);
    }

    state.exampleIds = exampleIds;
    state.revision += 1;
    this.options.store.saveDiscoverySession(state);
    this.scheduleRun(sessionId);
    return { id: sessionId, state: state.status };
  }

  inspect(sessionId: string): DiscoveryInspectView | undefined {
    const parsed = DiscoveryInspectArgsSchema.parse({ sessionId });
    const state = this.options.store.getDiscoverySessionState(parsed.sessionId);
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

  async waitForTerminal(sessionId: string, timeoutMs = 15_000): Promise<DiscoverySessionState | undefined> {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const state = this.options.store.getDiscoverySessionState(sessionId);
      if (!state) return undefined;
      if (isTerminalStatus(state.status) && !this.running.has(sessionId)) return state;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return this.options.store.getDiscoverySessionState(sessionId);
  }

  cancel(sessionId: string): DiscoverySessionState | undefined {
    const parsed = DiscoveryCancelArgsSchema.parse({ sessionId });
    const state = this.options.store.getDiscoverySessionState(parsed.sessionId);
    if (!state || isTerminalStatus(state.status)) return undefined;
    state.status = 'cancelled';
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    this.options.store.saveDiscoverySession(state);
    this.running.delete(parsed.sessionId);
    return state;
  }

  answer(sessionId: string, questionId: string, optionId: string): DiscoverySessionState | undefined {
    const state = this.options.store.getDiscoverySessionState(sessionId);
    if (!state?.pendingQuestion || state.pendingQuestion.id !== questionId) return undefined;
    const next = applyClarificationAnswer(state, state.pendingQuestion, optionId);
    this.options.store.saveDiscoverySession(next);
    return next;
  }

  publish(sessionId: string, name?: string): { workflowId: string } | { error: string } {
    const state = this.options.store.getDiscoverySessionState(sessionId);
    if (!state) return { error: 'discovery_not_found' };
    const gate = canPublish(state);
    if (!gate.ok) return { error: gate.reason };
    const blueprint = state.blueprint ?? buildDiscoveryBlueprint(state);
    if (!blueprint) return { error: 'blueprint_missing' };
    const defaultSourcePath = this.resolveDefaultSourcePath(blueprint);
    const workflow = compileBlueprintToWorkflow(blueprint, { name, defaultSourcePath });
    const saved = this.options.store.saveWorkflow(workflow);
    state.status = 'published';
    state.publishedWorkflowId = saved.workflowId;
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    this.options.store.saveDiscoverySession(state);
    return { workflowId: saved.workflowId };
  }

  private resolveDefaultSourcePath(blueprint: NonNullable<DiscoverySessionState['blueprint']>): string | undefined {
    const source = blueprint.sources.find((entry) => entry.connector === 'input_artifact');
    const storedPath = source?.metadata?.storedPath;
    return typeof storedPath === 'string' ? storedPath : undefined;
  }

  private scheduleRun(sessionId: string): void {
    setImmediate(() => {
      void this.runPipeline(sessionId).catch((error) => {
        const state = this.options.store.getDiscoverySessionState(sessionId);
        if (!state) return;
        state.status = 'failed';
        state.errorCode = 'pipeline_failed';
        state.errorMessage = error instanceof Error ? error.message : String(error);
        state.updatedAt = new Date().toISOString();
        this.options.store.saveDiscoverySession(state);
        this.running.delete(sessionId);
      });
    });
  }

  private async runPipeline(sessionId: string): Promise<void> {
    if (this.running.has(sessionId)) return;
    this.running.add(sessionId);
    const started = Date.now();

    let state = this.options.store.getDiscoverySessionState(sessionId);
    if (!state || state.status === 'cancelled') {
      this.running.delete(sessionId);
      return;
    }

    const examples = this.options.store.listDiscoveryExamples(sessionId);
    const observations: OutputObservation[] = [];

    state = this.transition(state, 'observing_output');
    for (const example of examples) {
      if (this.isCancelled(sessionId)) return;
      for (const artifactId of example.outputArtifactIds) {
        observations.push(...this.observeOutputArtifact(example.id, artifactId));
      }
    }
    state = this.patchState(sessionId, { observations });

    state = this.transition(state, 'inventory_sources');
    state = this.transition(state, 'exploring_sources');

    const snapshotsByExample: Record<string, Record<string, TableArtifact>> = {};
    const allSources = new Map<string, DiscoverySessionState['sourceInventory'][number]>();
    let sourceReadsUsed = state.budgets.sourceReadsUsed;

    for (const example of examples) {
      if (this.isCancelled(sessionId)) return;
      const inventory = await inventorySources(this.sourceRegistry, {
        store: this.options.store,
        artifactStore: this.artifactStore,
        snapshotDir: this.snapshotDir,
        exampleId: example.id,
        observations,
        inputArtifactIds: example.inputArtifactIds,
        budget: {
          sourceReadsUsed,
          sourceReadsMax: state.budgets.sourceReadsMax,
        },
      });
      sourceReadsUsed = inventory.budget.sourceReadsUsed;
      for (const source of inventory.sources) allSources.set(source.id, source);
      for (const snapshot of inventory.snapshots) {
        this.options.store.insertDiscoverySnapshot({
          id: snapshot.id,
          sessionId,
          exampleId: snapshot.exampleId,
          sourceId: snapshot.sourceId,
          kind: snapshot.kind,
          artifactId: snapshot.artifactId,
          manifestPath: snapshot.manifestPath,
          fingerprint: snapshot.fingerprint,
          queryJson: snapshot.queryJson,
          metadataJson: snapshot.metadataJson,
          capturedAt: new Date().toISOString(),
        });
        if (snapshot.table) {
          snapshotsByExample[snapshot.exampleId] ??= {};
          snapshotsByExample[snapshot.exampleId]![snapshot.sourceId] = snapshot.table;
        }
      }
      if (inventory.stoppedReason) break;
    }

    const sourceInventory = [...allSources.values()].map((source) => {
      if (source.connector !== 'input_artifact') return source;
      const artifactId = String(source.metadata?.artifactId ?? source.id.replace(/^input:/, ''));
      const stored = this.artifactStore.get(artifactId);
      if (!stored) return source;
      return {
        ...source,
        metadata: { ...source.metadata, artifactId, storedPath: stored.storedPath },
      };
    });

    state = this.patchState(sessionId, {
      sourceInventory,
      budgets: {
        ...state.budgets,
        sourceReadsUsed,
      },
    });

    if (this.isCancelled(sessionId)) return;

    state = this.transition(state, 'synthesizing');
    const enumerated = enumerateCandidates(observations, sourceInventory, snapshotsByExample[examples[0]?.id ?? ''] ?? {});
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

    state = this.transition(state, 'validating');
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

    state = this.patchState(sessionId, {
      candidates: replayed,
      pendingQuestion: question,
      blueprint,
      budgets: {
        ...state.budgets,
        elapsedMs: Date.now() - started,
      },
      status: nextStatus,
      errorCode: accepted.length > 0 && allRequiredCovered ? undefined : 'no_matching_candidate',
      errorMessage: accepted.length > 0 && allRequiredCovered
        ? undefined
        : 'Required output fields could not be replayed across every example.',
    });
    this.running.delete(sessionId);
  }

  private observeOutputArtifact(exampleId: string, artifactId: string): OutputObservation[] {
    return observeArtifact(exampleId, artifactId, this.artifactStore);
  }

  private isCancelled(sessionId: string): boolean {
    const state = this.options.store.getDiscoverySessionState(sessionId);
    if (!state) return true;
    if (state.status === 'cancelled') {
      this.running.delete(sessionId);
      return true;
    }
    return false;
  }

  private transition(state: DiscoverySessionState, to: DiscoverySessionState['status']): DiscoverySessionState {
    assertTransition(state.status, to);
    const next = {
      ...state,
      status: to,
      revision: state.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.options.store.saveDiscoverySession(next);
    return next;
  }

  private patchState(sessionId: string, patch: Partial<DiscoverySessionState>): DiscoverySessionState {
    const state = this.options.store.getDiscoverySessionState(sessionId);
    if (!state) throw new Error('session_not_found');
    const next = {
      ...state,
      ...patch,
      revision: state.revision + 1,
      updatedAt: new Date().toISOString(),
    };
    this.options.store.saveDiscoverySession(next);
    return next;
  }
}

// Backward-compatible type alias for callers that still pass exploration config.
export type WorkDiscoveryExplorationConfig = {
  sourceReadsMax?: number;
};
