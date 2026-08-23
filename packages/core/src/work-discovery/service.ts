import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { WorkflowStore } from '../store/workflow-store.js';
import { ArtifactStore } from '../store/artifact-store.js';
import { getAxDataPaths } from '../paths/ax-data.js';
import { DocumentArtifactSchema } from '../contracts/artifacts/document.js';
import type { TableArtifact } from '../contracts/artifacts/table.js';
import { applyClarificationAnswer } from './clarification/answer-apply.js';
import { buildClarificationQuestion } from './clarification/question.js';
import { buildDiscoveryBlueprint, canPublish } from './compile/blueprint.js';
import { compileBlueprintToWorkflow } from './compile/compile-workflow.js';
import { inventorySources } from './exploration/inventory.js';
import { observeDocumentArtifact } from './observation/observe-document.js';
import type { OutputObservation } from './observation/schema.js';
import {
  DiscoveryCancelArgsSchema,
  DiscoveryInspectArgsSchema,
  DiscoveryStartArgsSchema,
  type DiscoveryInspectView,
  type DiscoverySessionState,
  type DiscoveryStartArgs,
} from './schema.js';
import { assertTransition, isTerminalStatus } from './state-machine.js';
import { enumerateCandidates, replayCandidates } from './synthesis/index.js';

export interface WorkDiscoveryExplorationConfig {
  rdb?: {
    filePath: string;
    allowedTables: string[];
    rowLimit?: number;
  };
  localSheets?: Array<{ path: string; label: string }>;
  sourceReadsMax?: number;
}

export interface WorkDiscoveryServiceOptions {
  store: WorkflowStore;
  artifactStore?: ArtifactStore;
  snapshotDir?: string;
  exploration?: WorkDiscoveryExplorationConfig;
}

function observationDisplay(observation: OutputObservation): string {
  if (observation.value.kind === 'number') {
    return observation.value.display ?? String(observation.value.value);
  }
  if (observation.value.kind === 'text') return observation.value.value;
  return JSON.stringify(observation.value);
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

  constructor(private readonly options: WorkDiscoveryServiceOptions) {
    const paths = getAxDataPaths();
    this.artifactStore = options.artifactStore ?? new ArtifactStore(join(paths.root, 'artifacts'));
    this.snapshotDir = options.snapshotDir ?? join(paths.root, 'discovery', 'snapshots');
    mkdirSync(this.snapshotDir, { recursive: true });
  }

  start(args: DiscoveryStartArgs): { id: string; state: DiscoverySessionState['status'] } {
    const parsed = DiscoveryStartArgsSchema.parse(args);
    const now = new Date().toISOString();
    const sessionId = `wd_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const exampleIds: string[] = [];

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
        sourceReadsMax: this.options.exploration?.sourceReadsMax ?? 12,
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
        inputArtifactIds: parsed.inputArtifactIds ?? [],
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

    const passed = state.candidates.filter((candidate) =>
      candidate.status === 'accepted' || candidate.replayResults.some((entry) => entry.pass),
    ).length;

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
      replaySummary: {
        total: state.candidates.length,
        passed,
        failed: Math.max(0, state.candidates.length - passed),
      },
      workflowId: state.publishedWorkflowId,
      errorCode: state.errorCode,
      errorMessage: state.errorMessage,
    };
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
    const workflow = compileBlueprintToWorkflow(blueprint, { name });
    const saved = this.options.store.saveWorkflow(workflow);
    state.status = 'published';
    state.publishedWorkflowId = saved.workflowId;
    state.revision += 1;
    state.updatedAt = new Date().toISOString();
    this.options.store.saveDiscoverySession(state);
    return { workflowId: saved.workflowId };
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
      const found: OutputObservation[] = [];
      for (const artifactId of example.outputArtifactIds) {
        const document = this.loadDocumentArtifact(artifactId);
        if (!document) continue;
        found.push(...observeDocumentArtifact(example.id, document));
      }
      observations.push(...found);
    }
    state = this.patchState(sessionId, { observations });

    state = this.transition(state, 'inventory_sources');
    state = this.transition(state, 'exploring_sources');

    const exploration = this.options.exploration;
    const snapshotsByExample: Record<string, Record<string, TableArtifact>> = {};
    if (exploration && examples[0]) {
      const inventory = await inventorySources(examples[0].id, observations, {
        rdb: exploration.rdb,
        localSheets: exploration.localSheets,
        snapshotDir: this.snapshotDir,
        budget: {
          sourceReadsUsed: state.budgets.sourceReadsUsed,
          sourceReadsMax: state.budgets.sourceReadsMax,
        },
      });
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
          table: snapshot.table,
        });
        if (snapshot.table) {
          snapshotsByExample[snapshot.exampleId] ??= {};
          snapshotsByExample[snapshot.exampleId]![snapshot.sourceId] = snapshot.table;
        }
      }
      state = this.patchState(sessionId, {
        sourceInventory: inventory.sources,
        budgets: {
          ...state.budgets,
          sourceReadsUsed: inventory.budget.sourceReadsUsed,
          stoppedReason: inventory.stoppedReason,
        },
      });
    }

    if (this.isCancelled(sessionId)) return;

    state = this.transition(state, 'synthesizing');
    const exampleId = examples[0]?.id ?? '';
    const enumerated = enumerateCandidates(observations, state.sourceInventory, snapshotsByExample[exampleId] ?? {});
    const replayed = replayCandidates({
      candidates: enumerated,
      examples: examples.map((example) => ({
        exampleId: example.id,
        observations: observations.filter((entry) => entry.exampleId === example.id),
      })),
      snapshotsByExample,
    });

    state = this.transition(state, 'validating');
    const hasAccepted = replayed.some((candidate) => candidate.status === 'accepted');
    const question = hasAccepted ? buildClarificationQuestion({ sessionId, candidates: replayed }) : undefined;
    const nextStatus = !hasAccepted
      ? 'failed'
      : question
        ? 'needs_clarification'
        : 'ready_to_publish';

    const blueprint = hasAccepted && !question ? buildDiscoveryBlueprint({
      ...state,
      candidates: replayed,
    }) : undefined;

    state = this.patchState(sessionId, {
      candidates: replayed,
      pendingQuestion: question,
      blueprint,
      budgets: {
        ...state.budgets,
        elapsedMs: Date.now() - started,
      },
      status: nextStatus,
      errorCode: hasAccepted ? undefined : 'no_matching_candidate',
      errorMessage: hasAccepted ? undefined : 'No replay candidate matched the observed output.',
    });
    this.running.delete(sessionId);
  }

  private loadDocumentArtifact(artifactId: string) {
    const documentJson = this.artifactStore.getDocumentArtifact<unknown>(artifactId);
    if (documentJson) {
      const parsed = DocumentArtifactSchema.safeParse(documentJson);
      if (parsed.success) return parsed.data;
    }
    const json = this.artifactStore.getJson<unknown>(artifactId);
    if (json) {
      const parsed = DocumentArtifactSchema.safeParse(json);
      if (parsed.success) return parsed.data;
    }
    const stored = this.artifactStore.get(artifactId);
    if (!stored) return undefined;
    try {
      return DocumentArtifactSchema.parse({
        id: artifactId,
        text: readFileSync(stored.storedPath, 'utf8'),
        pages: [],
        tables: [],
        images: [],
      });
    } catch {
      return undefined;
    }
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
