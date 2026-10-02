import type { EditableToolResult, ExecutionResult, MessageSendBinding, ToolResultReview, ToolSendOutcome, WorkspaceChatMessage } from '@ax-studio/core';
import { MessageToolDraftSchema, ToolResultConfirmationSchema } from '@ax-studio/core/tool-result';
import type { AppState } from '../../apps/desktop/src/types/app-state';
import type { AxApi } from '../../apps/desktop/src/types/ax-api';

/** Renderer-only fixture. It has no provider SDK, credentials, server-side IO or real send path. */
export function installSyntheticToolApi(scenario: string) {
  const sources = new Map<string, EditableToolResult>();
  const outcomes = new Map<string, ToolSendOutcome>();
  const statuses = new Map<string, 'pending' | 'processing' | 'approved' | 'rejected' | 'failed'>();
  const seals = new Map<string, ToolResultReview>();
  const stateListeners = new Set<() => void>();
  const chatListeners = new Set<(event: { sessionId: string; executionId: string; status: 'success' | 'failed' | 'cancelled' }) => void>();
  type ToolRead = Awaited<ReturnType<AxApi['getToolResult']>>;
  const reads: Array<{ snapshot: ToolRead; resolve: (snapshot: ToolRead) => void }> = [];
  const pausedReviews: Array<{ snapshot: ToolResultReview; resolve: (snapshot: ToolResultReview) => void }> = [];
  const pausedSends: Array<() => void> = [];
  let pauseRead = false;
  let pauseReview = false;
  let pauseSend = false;
  let sendOutcome: 'sent' | 'unknown' = 'sent';
  let failRefresh = false;
  let keepOriginalEditor = false;
  const hostWarnings = new Map<string, { refreshWarning?: boolean; persistenceWarning?: boolean }>();
  const metrics = { updateRequests: 0, reviewRequests: 0, confirmRequests: 0, completedReads: 0, sends: 0, rejects: 0, unexpectedCalls: [] as string[], lastParams: {} as Record<string, unknown> };
  const sourcesFor = (tool: 'gmail' | 'slack'): EditableToolResult => ({
    approvalId: 'qa-approval-' + tool, executionId: 'qa-execution-' + tool, workspaceSessionId: 'qa-session-' + tool, actionId: 'send',
    paramsHash: 'a'.repeat(64), connectionHash: 'b'.repeat(64), connectionRevision: 1, revision: 0, tool,
    draft: tool === 'gmail' ? { tool, to: 'reviewer@example.test', subject: '검수 진행 안내', body: '안녕하세요.\n\n요청하신 검수 자료를 확인했습니다.\n확인된 사항을 정리해 안내드리겠습니다.\n\n감사합니다.' }
      : { tool, channel: '#qa-review', text: '이번 검수 결과를 공유합니다.\n\n• 화면 편집과 확인 동작을 점검했습니다.\n• 추가 확인 사항은 이 채널에서 정리하겠습니다.' },
    blockedFields: [],
  });
  for (const tool of ['gmail', 'slack'] as const) { const source = sourcesFor(tool); sources.set(source.approvalId, source); statuses.set(source.approvalId, 'pending'); }
  if (scenario === 'missing') sources.get('qa-approval-gmail')!.draft = { tool: 'gmail', to: '', subject: '직접 작성', body: '' };
  if (scenario === 'thread') { const source = sources.get('qa-approval-slack')!; source.threadReference = '100.000'; source.blockedFields = ['thread_ts']; }
  if (scenario === 'attachment') sources.get('qa-approval-gmail')!.blockedFields = ['attachments'];
  const messageFor = (tool: 'gmail' | 'slack'): WorkspaceChatMessage => {
    const source = sources.get('qa-approval-' + tool)!;
    return { role: 'assistant', content: '알려진 내용으로 초안을 준비했습니다. 오른쪽에서 직접 수정할 수 있습니다.', kind: 'execution_result', executionId: source.executionId, executionStatus: 'pending_approval',
      approval: { id: source.approvalId, title: tool === 'gmail' ? 'Gmail 검수 초안' : 'Slack 검수 메시지', reason: '외부 전송 전에 내용과 받는 곳을 확인해 주세요.', toolResult: {
        approvalId: source.approvalId, executionId: source.executionId, workspaceSessionId: source.workspaceSessionId, actionId: source.actionId, paramsHash: source.paramsHash, tool } } };
  };
  const dbMessage: WorkspaceChatMessage = { role: 'assistant', kind: 'execution_result', executionStatus: 'success', content: '요청한 표의 현재 페이지를 조회했습니다.', executionId: 'qa-read-execution', readResult: {
    id: 'qa-read-table', kind: 'table', name: 'qa_orders', truncated: true,
    columns: [{ name: 'id', type: 'integer', nullable: false, inferred: false }, { name: 'customer', label: '고객', type: 'string', nullable: true, inferred: false },
      { name: 'status', label: '상태', type: 'string', nullable: true, inferred: false }, { name: 'amount', label: '금액', type: 'number', nullable: true, inferred: false }],
    rows: [{ index: 0, values: { id: 1, customer: 'QA A', status: '검수 중', amount: 25000 } }, { index: 1, values: { id: 2, customer: 'QA B', status: '완료', amount: 48000 } },
      { index: 2, values: { id: 3, customer: '', status: null, amount: 12000 } }, { index: 3, values: { id: 4, customer: 'QA D', status: '대기', amount: 32000 } }],
    readScope: { schemaVersion: 1, kind: 'page', queryFingerprint: 'd'.repeat(64), table: 'qa_orders', accessMode: 'read_only', projection: 'all_columns', predicate: 'none', pagination: 'offset', scalarPolicy: 'preserve', offset: 0, limit: 4 },
    coverage: { schemaVersion: 1, page: 'complete', query: 'partial', source: 'partial', consistency: 'best_effort', reason: 'independent_offset_reads', observedRows: 4, hasMore: true },
    source: { executionId: 'qa-read-execution', readOnlyEnforced: true, database: 'postgres', schema: 'public', table: 'qa_orders', queryFingerprint: 'd'.repeat(64), capturedAt: '2026-10-02T09:00:00Z' },
  } };
  const chats = new Map<string, { id: string; title: string; messages: WorkspaceChatMessage[]; updatedAt: string }>([
    ['qa-session-gmail', { id: 'qa-session-gmail', title: 'Gmail 검수 초안', updatedAt: '2026-10-02T09:00:00Z', messages: [{ role: 'user', content: '확인된 내용으로 검수 안내 초안을 준비해줘.' }, messageFor('gmail')] }],
    ['qa-session-slack', { id: 'qa-session-slack', title: 'Slack 검수 메시지', updatedAt: '2026-10-02T08:00:00Z', messages: [{ role: 'user', content: '검수 채널에 공유할 내용을 정리해줘.' }, messageFor('slack')] }],
    ['qa-session-db', { id: 'qa-session-db', title: 'DB 검수 조회', updatedAt: '2026-10-02T07:00:00Z', messages: [{ role: 'user', content: '검수용 주문 표의 현재 페이지를 보여줘.' }, dbMessage] }],
  ]);
  if (scenario === 'history') chats.get('qa-session-gmail')!.messages.push({ role: 'assistant', content: '별도의 후속 답변입니다. 이전 초안은 결과에서 계속 확인할 수 있습니다.' }, structuredClone(dbMessage));
  const emit = () => stateListeners.forEach(listener => listener());
  const bindingFor = (source: EditableToolResult): MessageSendBinding => source.draft.tool === 'gmail'
    ? { provider: 'gmail', accountId: 'sender@example.test', accountLabel: 'sender@example.test', destinationId: source.draft.to.trim(), destinationLabel: source.draft.to.trim() }
    : { provider: 'slack', accountId: 'UQA123456', accountLabel: 'QA bot', workspaceId: 'TQA123456', workspaceLabel: 'QA 검수 워크스페이스', destinationId: 'CQA123456', destinationLabel: source.draft.channel.startsWith('#') ? source.draft.channel : '#qa-review' };
  if (scenario === 'completed-warning') {
    for (const source of sources.values()) {
      const outcome: ToolSendOutcome = { status: 'sent', receiptId: 'persisted-' + source.tool + '-receipt', paramsHash: 'c'.repeat(64), binding: bindingFor(source) };
      outcomes.set(source.approvalId, outcome); statuses.set(source.approvalId, 'approved');
      chats.get(source.workspaceSessionId)!.messages[1] = { role: 'assistant', content: '합성 저장된 전송 결과',
        kind: 'execution_result', executionId: source.executionId, executionStatus: 'success', toolSendOutcome: outcome };
    }
    hostWarnings.set('qa-execution-gmail', { refreshWarning: true });
  }
  const api = {
    getState: async (): Promise<AppState> => {
      if (failRefresh) throw new Error('Synthetic refresh failure');
      const pending = [...sources.values()].filter(source => statuses.get(source.approvalId) === 'pending');
      return { globalActive: true, works: [], connections: [], pendingApprovals: pending.length,
        approvals: pending.map(source => ({ id: source.approvalId, title: source.tool === 'gmail' ? 'Gmail 검수 초안' : 'Slack 검수 메시지', reason: '외부 전송 전 확인', createdAt: '2026-10-02T09:00:00Z', actionIds: ['send'] })),
        executions: [...sources.values()].map(source => ({ id: source.executionId, ephemeral: true, workspaceSessionId: source.workspaceSessionId, status: statuses.get(source.approvalId) === 'pending' ? 'pending_approval' : statuses.get(source.approvalId) === 'approved' ? 'success' : statuses.get(source.approvalId)!, startedAt: '2026-10-02T09:00:00Z' })),
        aiProviderLabel: '합성 QA', aiProviderInstalled: true, jevDecisionEnabled: false, jevDecisionConfigured: false };
    },
    listChatSessions: async () => [...chats.values()].map(chat => ({ id: chat.id, title: chat.title, updatedAt: chat.updatedAt, kind: 'workspace' as const, sourceCount: 0 })),
    loadWorkspaceChat: async (id: string) => { const chat = chats.get(id); if (!chat) throw new Error('Unknown synthetic chat'); return structuredClone(chat); },
    listWorkspaceSources: async () => ({ ok: true, sources: [] }),
    saveWorkspaceChat: async (id: string | undefined, messages: WorkspaceChatMessage[]) => {
      const existing = id ? chats.get(id) : undefined;
      const chat = { id: id ?? 'qa-session-new', title: existing?.title ?? 'QA 새 대화', updatedAt: '2026-10-02T09:00:00Z', messages: structuredClone(messages) };
      chats.set(chat.id, chat); return structuredClone(chat);
    },
    sendCommandChat: async () => ({ role: 'assistant' as const, content: '합성 후속 답변입니다. 외부 작업은 실행하지 않았습니다.',
      requestId: 'qa-synthetic-request', changedWorkflowIds: [], removedWorkflowIds: [], inputRequests: [], presentations: [] }),
    detectAiCli: async () => [], getAiConfig: async () => ({ path: 'synthetic-fixture', providers: {}, secrets: {} }),
    onStateChanged: (listener: () => void) => { stateListeners.add(listener); return () => { stateListeners.delete(listener); }; },
    onWorkspaceChatChanged: (listener: (event: { sessionId: string; executionId: string; status: 'success' | 'failed' | 'cancelled' }) => void) => { chatListeners.add(listener); return () => { chatListeners.delete(listener); }; },
    onChatProgress: () => () => undefined, onWorkspaceSourceChanged: () => () => undefined,
    getToolResult: async lookup => {
      const completed = typeof lookup !== 'string';
      const id = completed ? [...sources.values()].find(source => source.executionId === lookup.executionId)?.approvalId ?? '' : lookup;
      if (completed) metrics.completedReads++;
      const source = sources.get(id); const status = statuses.get(id);
      const snapshot: ToolRead = structuredClone({ source: !completed && status === 'pending' ? source : undefined,
        outcome: completed ? undefined : outcomes.get(id), requiresReview: !completed && !!source, cancelled: status === 'rejected', processing: status === 'processing',
        ...(completed ? { executionId: lookup.executionId, ...hostWarnings.get(lookup.executionId) } : {}) });
      if (pauseRead) { pauseRead = false; return new Promise<ToolRead>(resolve => { reads.push({ snapshot, resolve }); }); }
      return snapshot;
    },
    updateToolDraft: async input => {
      metrics.updateRequests++;
      const source = sources.get(input.approvalId);
      if (!source || statuses.get(input.approvalId) !== 'pending' || input.revision < source.revision) throw new Error('tool_result_stale');
      source.draft = MessageToolDraftSchema.parse(input.draft); source.revision = input.revision; seals.delete(input.approvalId);
      return structuredClone(source);
    },
    reviewToolResult: async input => {
      metrics.reviewRequests++;
      const source = sources.get(input.approvalId);
      if (!source || source.revision !== input.revision || source.blockedFields.length) throw new Error('tool_result_stale');
      const binding = bindingFor(source); const draft = structuredClone(source.draft);
      if (draft.tool === 'slack') draft.channel = binding.destinationId;
      const review: ToolResultReview = { confirmation: { approvalId: input.approvalId, workspaceSessionId: input.workspaceSessionId, sealId: crypto.randomUUID() }, revision: input.revision, draft, binding, paramsHash: 'c'.repeat(64) };
      seals.set(input.approvalId, review);
      if (pauseReview) return new Promise<ToolResultReview>(resolve => pausedReviews.push({ snapshot: review, resolve }));
      return structuredClone(review);
    },
    confirmToolResult: async input => {
      metrics.confirmRequests++;
      const confirmation = ToolResultConfirmationSchema.parse(input);
      const source = sources.get(confirmation.approvalId)!; const sealed = seals.get(confirmation.approvalId);
      if (!sealed || sealed.confirmation.sealId !== confirmation.sealId || statuses.get(confirmation.approvalId) !== 'pending') {
        return { executionId: source.executionId, status: 'failed', pendingApprovalId: source.approvalId, errorCode: 'tool_result_stale', log: [] };
      }
      statuses.set(source.approvalId, 'processing'); seals.delete(source.approvalId); metrics.sends++;
      metrics.lastParams = structuredClone(sealed.draft); emit();
      if (pauseSend) await new Promise<void>(resolve => pausedSends.push(resolve));
      const outcome: ToolSendOutcome = { status: sendOutcome, paramsHash: sealed.paramsHash, binding: sealed.binding, ...(sendOutcome === 'sent' ? { receiptId: 'synthetic-receipt-only' } : {}) };
      outcomes.set(source.approvalId, outcome); statuses.set(source.approvalId, sendOutcome === 'sent' ? 'approved' : 'failed');
      const result: ExecutionResult = { executionId: source.executionId, status: sendOutcome === 'sent' ? 'success' : 'failed', log: [], toolSendOutcome: outcome };
      const chat = chats.get(source.workspaceSessionId)!;
      if (!keepOriginalEditor) chat.messages = chat.messages.map(message => message.executionId === source.executionId ? { role: 'assistant', content: sendOutcome === 'sent' ? '합성 전송 완료' : '합성 결과 확인 필요', kind: 'execution_result', executionId: source.executionId, executionStatus: result.status, toolSendOutcome: outcome } : message);
      emit();
      if (!keepOriginalEditor) chatListeners.forEach(listener => listener({ sessionId: source.workspaceSessionId, executionId: source.executionId, status: result.status as 'success' | 'failed' }));
      return structuredClone(result);
    },
    reject: async (id: string) => {
      metrics.rejects++;
      if (statuses.get(id) !== 'pending') throw new Error('Already processing');
      statuses.set(id, 'rejected'); seals.delete(id); emit(); return { ok: true };
    },
    approve: async () => { throw new Error('tool_result_confirmation_required'); },
    deleteWorkspaceChat: async (id: string) => { chats.delete(id); return { ok: true }; },
  } satisfies Partial<AxApi>;
  Object.defineProperty(window, 'ax', { configurable: false, value: new Proxy(api, { get(target, key) {
    if (key in target) return Reflect.get(target, key);
    return async () => { metrics.unexpectedCalls.push(String(key)); throw new Error('Unsupported synthetic fixture API: ' + String(key)); };
  } }) });
  Object.defineProperty(window, '__axToolQa', { value: {
    metrics, scenario, pauseNextRead: () => { pauseRead = true; }, releaseReads: () => { reads.splice(0).forEach(read => read.resolve(read.snapshot)); },
    pauseReviews: () => { pauseReview = true; }, releaseReviews: () => { pauseReview = false; pausedReviews.splice(0).forEach(review => review.resolve(structuredClone(review.snapshot))); },
    pauseSends: () => { pauseSend = true; }, releaseSends: () => { pauseSend = false; pausedSends.splice(0).forEach(resolve => resolve()); },
    setSendOutcome: (value: 'sent' | 'unknown') => { sendOutcome = value; }, failRefresh: () => { failRefresh = true; }, keepOriginalEditor: () => { keepOriginalEditor = true; },
    connectionChanged: () => { sources.forEach(source => source.connectionRevision++); seals.clear(); emit(); }, emit,
  } });
}
