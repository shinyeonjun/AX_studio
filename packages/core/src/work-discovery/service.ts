import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowStore } from '../store/workflow-store.js';
import { ArtifactStore } from '../store/artifact-store.js';
import { getAxDataPaths } from '../paths/ax-data.js';
import { TableArtifactSchema, type TableArtifact } from '../contracts/artifacts/table.js';
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
  type DiscoveryRecoveryCheckpoint,
  type DiscoverySessionState,
  type DiscoveryStartArgs,
} from './schema.js';
import { assertTransition, isTerminalStatus } from './state-machine.js';
import { enumerateCandidates, replayCandidates, resolveReplayWinners } from './synthesis/index.js';
import { createDefaultDiscoverySourceRegistry } from './sources/index.js';
import type { DiscoverySourceRegistry } from './sources/registry.js';
import { ALL_MODULE_PACKAGES } from '../modules/packages/catalog.js';
import type { WorkbookMaterializer } from '../contracts/discovery-source.js';

export interface WorkDiscoveryServiceOptions {
  store: WorkflowStore;
  artifactStore?: ArtifactStore;
  resolveConnectionConfig?: (connector: string, config: unknown) => Promise<unknown> | unknown;
  snapshotDir?: string;
  sourceRegistry?: DiscoverySourceRegistry;
  sourceReadsMax?: number;
  autoResume?: boolean;
}

export interface DiscoveryRevisionConflict {
  error: 'discovery_revision_conflict';
  currentRevision: number;
}

const AUTO_RESUME_STATUSES: ReadonlySet<DiscoverySessionState['status']> = new Set([
  'collecting_examples',
  'observing_output',
  'inventory_sources',
  'exploring_sources',
  'synthesizing',
  'validating',
]);

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
    case 'needs_attention':
      return '복구 확인이 필요함';
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
  private readonly materializeWorkbook: WorkbookMaterializer['readWorkbookFromPath'];

  constructor(private readonly options: WorkDiscoveryServiceOptions) {
    const paths = getAxDataPaths();
    this.artifactStore = options.artifactStore ?? new ArtifactStore(paths.artifacts);
    this.snapshotDir = options.snapshotDir ?? join(paths.root, 'discovery', 'snapshots');
    mkdirSync(this.snapshotDir, { recursive: true });
    this.sourceRegistry = options.sourceRegistry ?? createDefaultDiscoverySourceRegistry(options.store, this.artifactStore);
    this.sourceReadsMax = options.sourceReadsMax ?? 12;
    this.materializeWorkbook = ALL_MODULE_PACKAGES.find((pkg) => pkg.id === 'local_sheet')?.materializeWorkbook
      ?? (() => { throw new Error('local_sheet module must register materializeWorkbook'); });
    if (options.autoResume) this.resumePendingSessions();
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
      desiredRecurrence: parsed.desiredRecurrence,
      sourceInventory: [],
      observations: [],
      candidates: [],
      budgets: {
        sourceReadsUsed: 0,
        sourceReadsMax: this.sourceReadsMax,
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

  retry(
    sessionId: string,
    expectedRevision: number,
  ): DiscoverySessionState | DiscoveryRevisionConflict | { error: string } {
    const state = this.options.store.getDiscoverySessionState(sessionId);
    if (!state) return { error: 'discovery_not_found' };
    if (state.revision !== expectedRevision) {
      return { error: 'discovery_revision_conflict', currentRevision: state.revision };
    }
    if (state.status !== 'needs_attention') return { error: 'discovery_not_needs_attention' };
    const checkpoint = state.recoveryCheckpoint;
    if (!checkpoint) return { error: 'discovery_checkpoint_missing' };

    let next: DiscoverySessionState;
    if (checkpoint === 'synthesizing' || checkpoint === 'validating') {
      next = {
        ...state,
        status: checkpoint,
        revision: state.revision + 1,
        errorCode: undefined,
        errorMessage: undefined,
        updatedAt: new Date().toISOString(),
      };
      this.options.store.saveDiscoverySession(next);
    } else {
      next = this.resetForRecovery(state);
    }
    this.scheduleRun(sessionId);
    return next;
  }

  answer(
    sessionId: string,
    questionId: string,
    optionId: string,
    expectedRevision?: number,
  ): DiscoverySessionState | DiscoveryRevisionConflict | undefined {
    const state = this.options.store.getDiscoverySessionState(sessionId);
    if (state && expectedRevision !== undefined && state.revision !== expectedRevision) {
      return { error: 'discovery_revision_conflict', currentRevision: state.revision };
    }
    if (!state?.pendingQuestion || state.pendingQuestion.id !== questionId) return undefined;
    const next = applyClarificationAnswer(state, state.pendingQuestion, optionId);
    this.options.store.saveDiscoverySession(next);
    return next;
  }

  publish(
    sessionId: string,
    name?: string,
    expectedRevision?: number,
  ): { workflowId: string } | DiscoveryRevisionConflict | { error: string } {
    const state = this.options.store.getDiscoverySessionState(sessionId);
    if (!state) return { error: 'discovery_not_found' };
    if (expectedRevision !== undefined && state.revision !== expectedRevision) {
      return { error: 'discovery_revision_conflict', currentRevision: state.revision };
    }
    if (state.status === 'published' && state.publishedWorkflowId) {
      return { workflowId: state.publishedWorkflowId };
    }
    const gate = canPublish(state);
    if (!gate.ok) return { error: gate.reason };
    const blueprint = state.blueprint ?? buildDiscoveryBlueprint(state);
    if (!blueprint) return { error: 'blueprint_missing' };
    const defaultSourcePath = this.resolveDefaultSourcePath(blueprint);
    const workflow = {
      ...compileBlueprintToWorkflow(blueprint, { name, defaultSourcePath }),
      id: `discovery_${state.id}`,
    };
    const saved = this.options.store.getWorkflow(workflow.id)
      ? { workflowId: workflow.id }
      : this.options.store.saveWorkflow(workflow);
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
        if (!state || state.status === 'cancelled') {
          this.running.delete(sessionId);
          return;
        }
        const automaticRecovery = (state.autoRecoveryAttempts ?? 0) > 0;
        state.status = automaticRecovery ? 'needs_attention' : 'failed';
        state.revision += 1;
        state.errorCode = automaticRecovery ? 'discovery_recovery_failed' : 'pipeline_failed';
        state.errorMessage = automaticRecovery
          ? `Automatic recovery stopped: ${error instanceof Error ? error.message : String(error)}`
          : error instanceof Error ? error.message : String(error);
        state.updatedAt = new Date().toISOString();
        this.options.store.saveDiscoverySession(state);
        this.running.delete(sessionId);
      });
    });
  }

  private resumePendingSessions(): void {
    for (const state of this.options.store.listDiscoverySessions()) {
      if (!AUTO_RESUME_STATUSES.has(state.status)) continue;
      if ((state.autoRecoveryAttempts ?? 0) > 0) {
        this.markNeedsAttention(state, 'discovery_recovery_exhausted', 'Automatic recovery has already been attempted.');
        continue;
      }
      const next = {
        ...state,
        autoRecoveryAttempts: 1,
        recoveryCheckpoint: state.status as DiscoveryRecoveryCheckpoint,
        revision: state.revision + 1,
        updatedAt: new Date().toISOString(),
      };
      this.options.store.saveDiscoverySession(next);
      this.scheduleRun(next.id);
    }
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
    let observations: OutputObservation[] = state.observations;
    let snapshotsByExample: Record<string, Record<string, TableArtifact>> = {};
    let sourceInventory: DiscoverySessionState['sourceInventory'] = state.sourceInventory;
    let sourceReadsUsed = state.budgets.sourceReadsUsed;
    const persistedSnapshots = this.loadPersistedSnapshotTables(state, examples.map((example) => example.id));
    const checkpointStatus = state.status === 'synthesizing' || state.status === 'validating';
    if (checkpointStatus && persistedSnapshots === undefined) {
      throw new Error('discovery_checkpoint_unavailable');
    }
    const resumeFromCheckpoint = checkpointStatus && persistedSnapshots !== undefined;

    if (resumeFromCheckpoint) {
      snapshotsByExample = persistedSnapshots;
    } else {
      if (state.status !== 'collecting_examples') {
        state = this.resetForRecovery(state);
        observations = [];
        sourceInventory = [];
        sourceReadsUsed = 0;
      }

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

      const allSources = new Map<string, DiscoverySessionState['sourceInventory'][number]>();
      for (const example of examples) {
        if (this.isCancelled(sessionId)) return;
        const inventory = await inventorySources(this.sourceRegistry, {
          store: this.options.store,
          artifactStore: this.artifactStore,
          resolveConnectionConfig: this.options.resolveConnectionConfig,
          snapshotDir: join(this.snapshotDir, sessionId),
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
          this.options.store.upsertDiscoverySnapshot({
            id: this.snapshotRecordId(sessionId, snapshot.exampleId, snapshot.sourceId),
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

      sourceInventory = [...allSources.values()].map((source) => {
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
    }
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

    for (const example of examples) {
      const exampleObservations = observations.filter((entry) => entry.exampleId === example.id);
      const exampleResults = replayed.map((candidate) => ({
        candidateId: candidate.id,
        observationPath: candidate.observationPath,
        result: candidate.replayResults.find((entry) => entry.exampleId === example.id),
      }));
      this.options.store.upsertDiscoveryReplayCase({
        id: `replay_${sessionId}_${example.id}`,
        sessionId,
        exampleId: example.id,
        snapshotSetId: `snapshot_set_${sessionId}_${example.id}`,
        expectedObservationsJson: JSON.stringify(exampleObservations),
        lastResultJson: JSON.stringify(exampleResults),
        createdAt: new Date().toISOString(),
      });
    }

    if (state.status === 'synthesizing') state = this.transition(state, 'validating');
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

  private loadPersistedSnapshotTables(
    state: DiscoverySessionState,
    exampleIds: string[],
  ): Record<string, Record<string, TableArtifact>> | undefined {
    if (state.sourceInventory.length === 0 || exampleIds.length === 0) return undefined;
    const records = this.options.store.listDiscoverySnapshots(state.id);
    if (records.length === 0) return undefined;
    const snapshotsByExample: Record<string, Record<string, TableArtifact>> = {};

    for (const record of records) {
      if (!record.manifestPath || !existsSync(record.manifestPath)) return undefined;
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(record.manifestPath, 'utf8')) as unknown;
      } catch {
        return undefined;
      }
      const parsed = TableArtifactSchema.safeParse(raw);
      if (!parsed.success) return undefined;
      snapshotsByExample[record.exampleId] ??= {};
      snapshotsByExample[record.exampleId]![record.sourceId] = parsed.data;
    }

    const hasAllSourceSnapshots = exampleIds.every((exampleId) => {
      const snapshots = snapshotsByExample[exampleId];
      return state.sourceInventory.every((source) => Boolean(snapshots?.[source.id]));
    });
    return hasAllSourceSnapshots ? snapshotsByExample : undefined;
  }

  private snapshotRecordId(sessionId: string, exampleId: string, sourceId: string): string {
    return `snap_${createHash('sha256')
      .update(`${sessionId}\0${exampleId}\0${sourceId}`)
      .digest('hex')
      .slice(0, 24)}`;
  }

  private resetForRecovery(state: DiscoverySessionState): DiscoverySessionState {
    const next: DiscoverySessionState = {
      ...state,
      status: 'collecting_examples',
      revision: state.revision + 1,
      sourceInventory: [],
      observations: [],
      candidates: [],
      pendingQuestion: undefined,
      blueprint: undefined,
      errorCode: undefined,
      errorMessage: undefined,
      budgets: {
        ...state.budgets,
        sourceReadsUsed: 0,
        elapsedMs: 0,
        stoppedReason: undefined,
      },
      updatedAt: new Date().toISOString(),
    };
    this.options.store.saveDiscoverySession(next);
    return next;
  }

  private markNeedsAttention(
    state: DiscoverySessionState,
    errorCode: string,
    errorMessage: string,
  ): DiscoverySessionState {
    const next: DiscoverySessionState = {
      ...state,
      status: 'needs_attention',
      recoveryCheckpoint: state.recoveryCheckpoint ?? (AUTO_RESUME_STATUSES.has(state.status)
        ? state.status as DiscoveryRecoveryCheckpoint
        : undefined),
      revision: state.revision + 1,
      errorCode,
      errorMessage,
      updatedAt: new Date().toISOString(),
    };
    this.options.store.saveDiscoverySession(next);
    return next;
  }

  private observeOutputArtifact(exampleId: string, artifactId: string): OutputObservation[] {
    return observeArtifact(exampleId, artifactId, this.artifactStore, this.materializeWorkbook);
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
