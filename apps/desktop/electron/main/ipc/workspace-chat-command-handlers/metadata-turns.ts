import {
  JevDecisionEngine, RequestUnderstandingSession, RequestUnderstandingInvalidatedError,
  runAxCommandChat, snapshotRegisteredHttpMetadata,
  type AxCommandService, type WorkflowStore, type WorkspaceChatMessage, type WorkspaceChatRecord,
  type WorkspaceChatPersistedReplyReceipt, type RequestUnderstandingResult, type SourceMetadataEvidence,
} from '@ax-studio/core';

interface OfflineInstallation {
  mode: 'offline_test';
  fetch: typeof fetch;
  onApprovedEvidence?: (evidence: SourceMetadataEvidence) => void;
}
interface Turn {
  store: WorkflowStore; sessionId: string; turnId?: string; text: string; generation: number;
  policyRevision: number; connectionRevision: number; dictionaryRevision: number;
  eligible: boolean; started: boolean; controller: AbortController; session?: RequestUnderstandingSession;
}
interface SessionOwner {
  generations: Map<string, number>; turns: Map<string, Turn>;
  catalogGeneration: number; connectionRevision: number; dictionaryRevision: number;
}
const owners = new WeakMap<WorkflowStore, SessionOwner>();
const activeTurns = new Set<Turn>();
const admittedTurns = new Set<Turn>();
let installation: OfflineInstallation | undefined;
let policyRevision = 0;

function owner(store: WorkflowStore) {
  let held = owners.get(store);
  if (!held) {
    held = { generations: new Map(), turns: new Map(), catalogGeneration: 1,
      connectionRevision: store.getConnectionRevision(), dictionaryRevision: store.getDiscoveryMetadataRevision() };
    owners.set(store, held);
  }
  const connectionRevision = store.getConnectionRevision();
  const dictionaryRevision = store.getDiscoveryMetadataRevision();
  if (held.connectionRevision !== connectionRevision || held.dictionaryRevision !== dictionaryRevision) {
    held.connectionRevision = connectionRevision;
    held.dictionaryRevision = dictionaryRevision;
    held.catalogGeneration++;
  }
  return held;
}
function invalidate(turn: Turn) {
  turn.controller.abort();
  turn.session?.cancel();
  activeTurns.delete(turn);
  admittedTurns.delete(turn);
}

/** Internal test/research installation only. No startup, UI or environment path calls this. */
export function installRegisteredHttpMetadataOffline(value?: OfflineInstallation): void {
  if (value && (value.mode !== 'offline_test' || typeof value.fetch !== 'function')) throw new Error('metadata_offline_transport_required');
  for (const turn of admittedTurns) invalidate(turn);
  installation = value ? Object.freeze({ ...value }) : undefined;
  policyRevision++;
}
export function registeredHttpMetadataAvailable(): boolean { return installation?.mode === 'offline_test'; }

/** Called synchronously immediately after successful store persistence, before any evaluation. */
export function observeSavedWorkspaceTurn(store: WorkflowStore, before: readonly WorkspaceChatMessage[],
  saved: WorkspaceChatRecord, metadataPreference: boolean): void {
  const userTurns = (messages: readonly WorkspaceChatMessage[]) => messages.filter(message => message.role === 'user')
    .map(message => [message.turnId ?? null, message.content]);
  if (JSON.stringify(userTurns(before)) === JSON.stringify(userTurns(saved.messages))) return;
  const held = owner(store);
  const prior = held.turns.get(saved.id);
  if (prior) invalidate(prior);
  const generation = (held.generations.get(saved.id) ?? 0) + 1;
  held.generations.set(saved.id, generation);
  const user = saved.messages.filter(message => message.role === 'user').at(-1);
  if (!user) { held.turns.delete(saved.id); return; }
  const turn: Turn = { store, sessionId: saved.id, turnId: user.turnId, text: user.content, generation,
    policyRevision, connectionRevision: store.getConnectionRevision(), dictionaryRevision: store.getDiscoveryMetadataRevision(),
    eligible: metadataPreference && registeredHttpMetadataAvailable(), started: false, controller: new AbortController() };
  held.turns.set(saved.id, turn);
  if (turn.eligible) admittedTurns.add(turn);
}

function assertCurrent(turn: Turn): void {
  const held = owner(turn.store);
  if (held.turns.get(turn.sessionId) !== turn || held.generations.get(turn.sessionId) !== turn.generation
    || turn.policyRevision !== policyRevision || !registeredHttpMetadataAvailable()
    || turn.store.getConnectionRevision() !== turn.connectionRevision
    || turn.store.getDiscoveryMetadataRevision() !== turn.dictionaryRevision) {
    invalidate(turn);
    throw new RequestUnderstandingInvalidatedError('superseded');
  }
  if (turn.controller.signal.aborted) throw new RequestUnderstandingInvalidatedError('cancelled');
}

export function cancelMetadataRequest(requestId: string): boolean {
  let cancelled = false;
  for (const turn of admittedTurns) if (turn.turnId === requestId) { invalidate(turn); cancelled = true; }
  return cancelled;
}
export function cancelMetadataSession(sessionId: string): number {
  let cancelled = 0;
  for (const turn of admittedTurns) if (turn.sessionId === sessionId) { invalidate(turn); cancelled++; }
  return cancelled;
}
export function shutdownMetadataTurns(): void {
  for (const turn of admittedTurns) invalidate(turn);
}

export type MetadataDesktopStop = RequestUnderstandingResult['stop'] | 'gate_unavailable' | 'continuation_not_supported'
  | 'turn_not_admitted' | 'duplicate_request' | 'cancelled' | 'conflict';
export function metadataTerminalReply(requestId: string, stop: MetadataDesktopStop, content: string) {
  return { role: 'assistant' as const, content, requestId, metadataStop: stop,
    changedWorkflowIds: [] as string[], removedWorkflowIds: [] as string[], inputRequests: [], presentations: [] };
}

export async function runRegisteredHttpMetadataTurn(input: {
  store: WorkflowStore; commandService: AxCommandService; harness: Parameters<typeof runAxCommandChat>[0]['harness'];
  sessionId: string; requestId: string; userText: string;
  onProgress: (message: string) => void;
}) {
  if (!installation) return metadataTerminalReply(input.requestId, 'gate_unavailable', '등록된 HTTP 메타데이터 경로를 현재 사용할 수 없습니다.');
  const held = owner(input.store);
  const turn = held.turns.get(input.sessionId);
  if (!turn || !turn.eligible || turn.turnId !== input.requestId || turn.text !== input.userText) {
    return metadataTerminalReply(input.requestId, 'turn_not_admitted', '정확한 새 사용자 턴을 먼저 저장해야 합니다. 이전 턴의 의도나 권한은 이어받지 않습니다.');
  }
  if (turn.started) return metadataTerminalReply(input.requestId, 'duplicate_request', '이미 처리한 요청 ID입니다. 같은 요청을 다시 실행하지 않았습니다.');
  turn.started = true;
  activeTurns.add(turn);
  const installed = installation;
  let outcome: RequestUnderstandingResult | undefined;
  try {
    assertCurrent(turn);
    const snapshot = snapshotRegisteredHttpMetadata(input.store, { catalogRevision: held.catalogGeneration, policyRevision });
    turn.session = new RequestUnderstandingSession({ text: input.userText, requestId: input.requestId,
      workspaceSessionId: input.sessionId, catalog: snapshot.catalog, initialRequestRevision: turn.generation,
      metadataAdapter: snapshot.adapter, assertHostCurrent: () => assertCurrent(turn) });
    const engine = new JevDecisionEngine({ apiKey: 'offline-scripted-transport', baseURL: 'https://offline.invalid',
      model: 'offline-scripted', fetch: async (url, init) => {
        assertCurrent(turn);
        return installed.fetch(url, init);
      } });
    assertCurrent(turn);
    input.onProgress('등록된 로컬 HTTP 메타데이터를 확인하고 있습니다.');
    assertCurrent(turn);
    const content = await runAxCommandChat({ requestId: input.requestId, workspaceSessionId: input.sessionId,
      harness: input.harness, commandService: input.commandService, decisionEngine: engine,
      messages: [], userMessage: input.userText, abortSignal: turn.controller.signal,
      requestUnderstanding: { session: turn.session, onResult: result => { assertCurrent(turn); outcome = result; } },
      onCommandResult: result => {
        assertCurrent(turn);
        installed.onApprovedEvidence?.(result.data as SourceMetadataEvidence);
        assertCurrent(turn);
      },
      onProgress: ({ message }) => { assertCurrent(turn); input.onProgress(message); assertCurrent(turn); },
    });
    assertCurrent(turn);
    if (!outcome) return metadataTerminalReply(input.requestId, 'conflict', '요청 판단을 확인하지 못해 답변을 저장하지 않았습니다.');
    const current = input.store.getWorkspaceChat(input.sessionId);
    if (!current?.transcriptRevision) throw new RequestUnderstandingInvalidatedError('superseded');
    const saved = input.store.appendWorkspaceChatMetadataReply({ sessionId: input.sessionId, turnId: input.requestId,
      userText: input.userText, reply: content, expectedTranscriptRevision: current.transcriptRevision,
      assertCurrent: () => assertCurrent(turn) });
    const persistedReply: WorkspaceChatPersistedReplyReceipt = { kind: 'registered_http_metadata', sessionId: input.sessionId,
      requestId: input.requestId, turnId: input.requestId, requestGeneration: turn.generation,
      transcriptRevision: saved.transcriptRevision! };
    return { ...metadataTerminalReply(input.requestId, outcome.stop, content), persistedReply };
  } catch (error) {
    if (error instanceof RequestUnderstandingInvalidatedError || turn.controller.signal.aborted) {
      return metadataTerminalReply(input.requestId, 'cancelled', '취소되거나 새 턴으로 대체된 메타데이터 요청입니다. 답변을 게시하지 않았습니다.');
    }
    return metadataTerminalReply(input.requestId, 'conflict', '메타데이터 요청 또는 대화 저장 상태가 바뀌었습니다. 현재 대화를 다시 확인해 주세요.');
  } finally {
    activeTurns.delete(turn);
    admittedTurns.delete(turn);
  }
}
