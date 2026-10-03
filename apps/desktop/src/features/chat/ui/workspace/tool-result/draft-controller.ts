import { MessageToolDraftSchema, missingToolEssentials, validGmailRecipient } from '@ax-studio/core/tool-result';
import type { EditableToolResult, ExecutionResult, MessageToolDraft, ToolDraftUpdate,
  ToolReviewRequest, ToolResultReview, ToolResultConfirmation, ToolSendOutcome } from '@ax-studio/core';

export interface ToolDraftApi {
  update: (input: ToolDraftUpdate) => Promise<EditableToolResult>;
  review: (input: ToolReviewRequest) => Promise<ToolResultReview>;
}
export interface ToolDraftState {
  draft: MessageToolDraft;
  revision: number;
  phase: 'editing' | 'preparing' | 'review' | 'sending' | 'sent' | 'cancelling' | 'cancelled' | 'unresolved';
  error: string;
  review?: ToolResultReview;
  refreshWarning?: boolean;
  persistenceWarning?: boolean;
  outcome?: ToolSendOutcome;
}
export function toolDraftError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('database_persistence_failed')) return '로컬 기록을 저장하지 못해 전송하지 않았습니다. 수정 내용은 유지됩니다. 저장 문제를 해결한 뒤 다시 확인해 주세요.';
  if (message.includes('recipient_invalid')) return '받는 사람의 정확한 이메일 주소를 입력해 주세요.';
  if (message.includes('essentials_missing')) return '받는 곳과 메시지 내용을 입력해 주세요.';
  if (message.includes('destination_unknown')) return '이 연결에서 받는 채널을 확인할 수 없습니다. 정확한 채널을 확인해 주세요.';
  if (message.includes('identity_unverified')) return '보내는 계정과 받는 곳을 확인할 수 없습니다. 연결 상태를 확인해 주세요.';
  if (message.includes('unsupported')) return '이 요청에 지원되지 않는 전송 옵션이 있습니다. 요청은 전송되지 않았습니다.';
  if (message.includes('stale') || message.includes('approval_target_changed')) return '내용 또는 연결이 바뀌었습니다. 전송 전에 다시 확인해 주세요.';
  return '전송 준비를 완료하지 못했습니다. 초안을 확인한 뒤 다시 시도해 주세요.';
}

/** Synchronous locks guard double clicks; host revisions/seals remain authoritative. */
export class ToolDraftController {
  private listeners = new Set<() => void>();
  private active = true;
  private viewEpoch = 0;
  private updates: Promise<void> = Promise.resolve();
  private updateFailed = false;
  private state: ToolDraftState;
  constructor(public source: EditableToolResult, private readonly api: ToolDraftApi) {
    this.state = { draft: structuredClone(source.draft), revision: source.revision, phase: 'editing', error: '' };
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() {
    this.active = true;
    if (this.state.phase === 'preparing' || this.state.phase === 'review') this.back();
  }
  dispose() { if (this.active) this.back(); this.active = false; this.viewEpoch++; }
  private update(state: ToolDraftState) { this.state = state; this.listeners.forEach(listener => listener()); }
  syncSource(source: EditableToolResult) {
    if (source.approvalId !== this.source.approvalId || source.workspaceSessionId !== this.source.workspaceSessionId) return;
    const changed = source.connectionRevision !== this.source.connectionRevision || source.paramsHash !== this.source.paramsHash;
    this.source = source;
    if (changed && ['editing', 'preparing', 'review'].includes(this.state.phase)) {
      this.viewEpoch++;
      this.update({ ...this.state, phase: 'editing', review: undefined, error: '연결이 바뀌었습니다. 전송 전에 다시 확인해 주세요.' });
    }
  }
  private persistEdit() {
    const input = { approvalId: this.source.approvalId, workspaceSessionId: this.source.workspaceSessionId,
      revision: this.state.revision, draft: structuredClone(this.state.draft) };
    this.updateFailed = false;
    this.updates = this.updates.then(async () => {
      try { await this.api.update(input); }
      catch (error) {
        if (this.state.revision === input.revision && ['editing', 'preparing'].includes(this.state.phase)) {
          this.updateFailed = true;
          this.update({ ...this.state, phase: 'editing', error: toolDraftError(error) });
        }
      }
    });
  }
  edit(draft: MessageToolDraft) {
    if (!this.active || !['editing', 'preparing', 'review'].includes(this.state.phase) || draft.tool !== this.source.tool) return;
    const parsed = MessageToolDraftSchema.safeParse(draft);
    if (!parsed.success) return;
    this.update({ draft: parsed.data, revision: this.state.revision + 1, phase: 'editing', error: '' });
    this.persistEdit();
  }
  async review() {
    if (!this.active || this.state.phase !== 'editing') return;
    if (this.source.blockedFields.length) { this.update({ ...this.state, error: toolDraftError('unsupported') }); return; }
    const draft = this.state.draft;
    const missing = missingToolEssentials(draft);
    if (missing.length || (draft.tool === 'gmail' && !validGmailRecipient(draft.to))) {
      const labels: Record<string, string> = { recipient: '받는 사람', body: '본문', channel: '채널', message: '메시지' };
      this.update({ ...this.state, error: missing.length ? '입력이 필요합니다: ' + missing.map(field => labels[field]).join(', ') + '.'
        : toolDraftError('recipient_invalid') });
      return;
    }
    const epoch = this.viewEpoch;
    const revision = this.state.revision;
    this.update({ ...this.state, phase: 'preparing', error: '' });
    await this.updates;
    if (!this.active || epoch !== this.viewEpoch || revision !== this.state.revision) return;
    if (this.updateFailed) { this.update({ ...this.state, phase: 'editing' }); return; }
    try {
      const review = await this.api.review({ approvalId: this.source.approvalId, workspaceSessionId: this.source.workspaceSessionId, revision });
      if (!this.active || epoch !== this.viewEpoch || revision !== this.state.revision || this.getSnapshot().phase !== 'preparing') return;
      this.update({ ...this.state, phase: 'review', draft: structuredClone(review.draft), review: structuredClone(review), error: '' });
    } catch (error) {
      if (this.active && epoch === this.viewEpoch && revision === this.state.revision && this.getSnapshot().phase === 'preparing') {
        this.update({ ...this.state, phase: 'editing', review: undefined, error: toolDraftError(error) });
      }
    }
  }
  back() {
    if (this.active && ['review', 'preparing'].includes(this.state.phase)) {
      this.viewEpoch++;
      this.update({ ...this.state, revision: this.state.revision + 1, phase: 'editing', review: undefined, error: '' });
      this.persistEdit();
    }
  }
  async confirm(send: (confirmation: ToolResultConfirmation) => Promise<ExecutionResult>) {
    if (!this.active || this.state.phase !== 'review' || !this.state.review) return;
    const confirmation = structuredClone(this.state.review.confirmation);
    this.update({ ...this.state, phase: 'sending', error: '' });
    try {
      const result = await send(confirmation);
      if (result.pendingApprovalId === this.source.approvalId) {
        this.update({ ...this.state, phase: 'editing', review: undefined, error: toolDraftError(result.errorCode ?? result.status) });
      } else {
        const sent = result.toolSendOutcome?.status === 'sent' && !!result.toolSendOutcome.receiptId;
        this.update({ ...this.state, phase: sent ? 'sent' : 'unresolved',
          outcome: result.toolSendOutcome && structuredClone(result.toolSendOutcome),
          refreshWarning: result.refreshWarning, persistenceWarning: result.errorCode === 'database_persistence_failed', error: sent ? '' : '전송 결과를 확인할 수 없습니다. 중복 전송을 피하려면 서비스에서 결과를 확인해 주세요.' });
      }
    } catch {
      this.update({ ...this.state, phase: 'unresolved', error: '전송 결과를 확인할 수 없습니다. 중복 전송을 피하려면 서비스에서 결과를 확인해 주세요.' });
    }
  }
  async cancel(reject: (approvalId: string) => Promise<void>) {
    if (!this.active || !['editing', 'preparing', 'review'].includes(this.state.phase)) return;
    this.viewEpoch++;
    this.update({ ...this.state, phase: 'cancelling', review: undefined, error: '' });
    try {
      await reject(this.source.approvalId);
      const draft: MessageToolDraft = this.source.tool === 'gmail' ? { tool: 'gmail', to: '', subject: '', body: '' }
        : { tool: 'slack', channel: '', text: '' };
      this.source = { ...this.source, draft };
      this.update({ ...this.state, draft, phase: 'cancelled' });
    } catch (error) {
      this.update({ ...this.state, phase: 'editing', error: toolDraftError(error) });
    }
  }
}

/** In-memory session cache preserves edits across ordinary navigation; restart clears it. */
const controllers = new Map<string, ToolDraftController>();
export function cachedToolDraft(source: EditableToolResult, api: ToolDraftApi): ToolDraftController {
  const key = source.workspaceSessionId + ':' + source.approvalId;
  const existing = controllers.get(key);
  if (existing) { existing.syncSource(source); return existing; }
  const controller = new ToolDraftController(source, api);
  controllers.set(key, controller);
  return controller;
}
/** Completion views retain action warnings even when a chat reload replaces the editor. */
export function cachedToolDraftForExecution(executionId: string | undefined, tool: MessageToolDraft['tool']): ToolDraftController | undefined {
  if (!executionId) return;
  return [...controllers.values()].find(controller => controller.source.executionId === executionId && controller.source.tool === tool);
}
export function clearToolDrafts(sessionId: string) {
  for (const [key, controller] of controllers) {
    if (controller.source.workspaceSessionId === sessionId) { controller.dispose(); controllers.delete(key); }
  }
}
