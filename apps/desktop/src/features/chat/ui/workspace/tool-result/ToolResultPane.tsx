import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { EditableToolResult, ExecutionResult, MessageToolDraft, ToolResultConfirmation,
  ToolResultReference, ToolSendOutcome, WorkspaceChatMessage } from '@ax-studio/core';
import { CONNECTOR_UI_CATALOG } from '../../../../../ui/constants/connectors';
import { cachedToolDraft, cachedToolDraftForExecution, type ToolDraftController, toolDraftError } from './draft-controller';
import './tool-result.css';

export interface ToolResultPaneProps {
  message: WorkspaceChatMessage;
  busy: boolean;
  active?: boolean;
  onConfirm: (confirmation: ToolResultConfirmation) => Promise<ExecutionResult>;
  onCancel: (approvalId: string) => Promise<void>;
}

export function toolResultMessages(messages: WorkspaceChatMessage[]): WorkspaceChatMessage[] {
  return messages.filter(message => message.role === 'assistant' && (message.approval?.toolResult || message.readResult?.readScope || message.toolSendOutcome));
}

export function latestToolResult(messages: WorkspaceChatMessage[]): WorkspaceChatMessage | undefined {
  return toolResultMessages(messages).at(-1);
}

export function GmailBrandIcon() {
  return (
    <svg className="tool-result-brand-icon" viewBox="0 0 24 24" width="30" height="30" fill="none" aria-hidden="true">
      <path d="M2.25 6.75C2.25 5.507 3.257 4.5 4.5 4.5h1.5l6 4.5 6-4.5h1.5c1.243 0 2.25 1.007 2.25 2.25v10.5a2.25 2.25 0 01-2.25 2.25h-3v-7.5l-4.5 3.375L7.5 12V19.5h-3A2.25 2.25 0 012.25 17.25V6.75z" fill="#4285F4"/>
      <path d="M19.5 4.5h-1.5v7.5l3.75-2.812V6.75c0-1.243-1.007-2.25-2.25-2.25z" fill="#34A853"/>
      <path d="M6 4.5H4.5C3.257 4.5 2.25 5.507 2.25 6.75v2.438L6 12V4.5z" fill="#EA4335"/>
      <path d="M18 4.5l-6 4.5-6-4.5" stroke="#FBBC05" strokeWidth="0.8"/>
    </svg>
  );
}

export function SlackBrandIcon() {
  return (
    <svg className="tool-result-brand-icon" viewBox="0 0 127 127" width="28" height="28" aria-hidden="true">
      <path d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z" fill="#E01E5A"/>
      <path d="M47 27.2c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.7 39.7.8 47 .8c7.3 0 13.2 5.9 13.2 13.2v13.2H47zm0 6.6c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H14C6.7 60.2.8 54.3.8 47c0-7.3 5.9-13.2 13.2-13.2H47z" fill="#36C5F0"/>
      <path d="M99.8 47c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.8V47zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V14c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33z" fill="#2EB67D"/>
      <path d="M80 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8H80zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80z" fill="#ECB22E"/>
    </svg>
  );
}

function ToolHeader({ tool, title, badge = '미전송 초안' }: { tool: 'gmail' | 'slack' | 'rdb'; title: string; badge?: string }) {
  const brand = CONNECTOR_UI_CATALOG[tool];
  return (
    <header className="tool-result-header">
      <div className="tool-result-header-main">
        {tool === 'gmail' ? (
          <GmailBrandIcon />
        ) : tool === 'slack' ? (
          <SlackBrandIcon />
        ) : brand.icon ? (
          <img src={brand.icon} alt="" aria-hidden="true" className="tool-result-brand-icon" />
        ) : (
          <span className="tool-result-db-icon" aria-hidden="true">{brand.emoji}</span>
        )}
        <div className="tool-result-header-text">
          <div className="tool-result-title-row">
            <h2>{title}</h2>
            <span className={'tool-result-badge' + (tool === 'rdb' ? ' tool-result-badge--read' : '')}>{badge}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

function MessageDraftFields({
  draft,
  locked,
  source,
  workspaceLabel,
  onEdit,
}: {
  draft: MessageToolDraft;
  locked: boolean;
  source: EditableToolResult;
  workspaceLabel?: string;
  onEdit: (draft: MessageToolDraft) => void;
}) {
  // Only controls that change the host-owned draft are rendered. Attachments are not
  // sendable yet, so no attachment chips are shown that could imply otherwise.
  return draft.tool === 'gmail' ? (
    <div className="tool-result-form tool-result-form--gmail">
      <div className="tool-result-field-group">
        <label className="tool-result-field">
          <span>받는 사람</span>
          <input
            aria-label="받는 사람"
            value={draft.to}
            disabled={locked}
            required
            placeholder="받는 사람의 정확한 이메일"
            maxLength={2000}
            onChange={event => onEdit({ ...draft, to: event.target.value })}
          />
        </label>
        <label className="tool-result-field">
          <span>제목</span>
          <input
            aria-label="제목"
            value={draft.subject}
            disabled={locked}
            placeholder="제목 없음"
            maxLength={2000}
            onChange={event => onEdit({ ...draft, subject: event.target.value })}
          />
        </label>
      </div>

      <div className="tool-result-editor-card tool-result-editor-card--gmail">
        <label className="tool-result-editor">
          <span>본문</span>
          <textarea
            aria-label="메일 본문"
            value={draft.body}
            disabled={locked}
            required
            placeholder="내용을 직접 작성할 수 있습니다"
            maxLength={60000}
            onChange={event => onEdit({ ...draft, body: event.target.value })}
          />
        </label>
        <div className="tool-result-attachment-bar">
          <div className="tool-result-attachment-left">
            <span className="tool-result-attachment-icon" aria-hidden="true">📎</span>
            <span className="tool-result-attachment-notice">
              {source.blockedFields.includes('attachments')
                ? '첨부 요청이 보존되어 있습니다. 첨부 전송을 지원하지 않아 이 요청은 전송할 수 없습니다.'
                : '첨부 전송은 아직 지원되지 않습니다.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div className="tool-result-form tool-result-form--slack">
      <div className="tool-result-slack-channel-bar">
        <span className="slack-channel-icon" aria-hidden="true">✏️</span>
        <div className="slack-channel-path-wrap">
          {workspaceLabel ? <span className="slack-channel-path-prefix">{workspaceLabel} / </span> : null}
          <input
            aria-label="Slack 채널"
            value={draft.channel}
            disabled={locked}
            required
            placeholder="정확한 채널 이름 또는 ID"
            maxLength={2000}
            onChange={event => onEdit({ ...draft, channel: event.target.value })}
            className="slack-channel-input"
          />
        </div>
      </div>
      <div className="tool-result-thread">
        <strong>{source.threadReference ? '스레드 답글 요청' : '새 채널 메시지'}</strong>
        <span>{source.threadReference ? '대상 ' + source.threadReference + ' · 스레드 전송 미지원' : '스레드 답장과 파일 게시 미지원'}</span>
      </div>

      <div className="tool-result-editor-card tool-result-editor-card--slack">
        <label className="tool-result-editor">
          <span>메시지</span>
          <textarea
            aria-label="Slack 메시지"
            value={draft.text}
            disabled={locked}
            required
            placeholder="메시지를 직접 작성할 수 있습니다"
            maxLength={60000}
            onChange={event => onEdit({ ...draft, text: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}

export function EditableMessageResult({
  controller,
  busy,
  active = true,
  onConfirm,
  onCancel,
}: {
  controller: ToolDraftController;
  busy: boolean;
  active?: boolean;
  onConfirm: ToolResultPaneProps['onConfirm'];
  onCancel: ToolResultPaneProps['onCancel'];
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const focusAfterBack = useRef(false);
  useEffect(() => { if (active) controller.activate(); else controller.dispose(); return () => controller.dispose(); }, [controller, active]);
  useEffect(() => { if (state.phase === 'review') confirmButton.current?.focus(); }, [state.phase]);
  useEffect(() => {
    if (state.phase === 'editing' && focusAfterBack.current) {
      reviewButton.current?.focus();
      focusAfterBack.current = false;
    }
  }, [state.phase]);
  const reviewing = state.phase === 'review';
  const locked = !active || busy || ['sending', 'cancelling', 'sent', 'cancelled', 'unresolved'].includes(state.phase);
  const preparing = state.phase === 'preparing';
  const gmail = state.draft.tool === 'gmail';
  const terminal = ['sent', 'cancelled', 'unresolved'].includes(state.phase);
  const binding = state.review?.binding;
  const source = controller.source;
  const back = () => { focusAfterBack.current = true; controller.back(); };
  return (
    <section className={`tool-result-pane tool-result-pane--${state.draft.tool}`} aria-label={gmail ? 'Gmail 결과 편집' : 'Slack 결과 편집'} aria-busy={preparing || state.phase === 'sending'}
      onKeyDown={event => { if (event.key === 'Escape' && (reviewing || preparing)) { event.preventDefault(); back(); } }}>
      <ToolHeader
        tool={state.draft.tool}
        title={state.draft.tool === 'gmail' ? (state.draft.subject.startsWith('Re:') ? 'Gmail · 답장 초안' : 'Gmail · 메일 초안') : 'Slack · 메시지 초안'}
        badge={state.phase === 'sent' ? '전송 완료' : state.phase === 'cancelled' ? '취소됨' : state.phase === 'cancelling' ? '취소 처리 중'
          : state.phase === 'unresolved' ? '결과 확인 필요' : state.phase === 'sending' ? '전송 처리 중' : '미전송 초안'}
      />
      <p className="tool-result-destination"><span>{gmail ? '보내는 계정' : '워크스페이스 · 보내는 계정'}</span>
        <strong>{binding ? (gmail ? binding.accountLabel : (binding.workspaceLabel ?? binding.workspaceId) + ' · ' + binding.accountLabel) : '전송 전 확인에서 연결 계정 자동 검증'}</strong></p>
      {reviewing && binding && <div className="tool-result-review" role="status"><strong>{gmail ? '이 내용으로 메일을 보낼까요?' : '이 내용으로 Slack에 게시할까요?'}</strong>
        <p>{binding.accountLabel} → {binding.destinationLabel}{binding.provider === 'slack' ? ' (' + binding.destinationId + ')' : ''}</p>
        <small>아직 전송되지 않았습니다. 수정하면 다시 확인합니다.</small></div>}
      <MessageDraftFields
        draft={state.draft}
        locked={locked}
        source={source}
        workspaceLabel={binding?.workspaceLabel}
        onEdit={draft => controller.edit(draft)}
      />
      {source.blockedFields.length > 0 && <p className="tool-result-error" role="alert">지원되지 않는 첨부·스레드 또는 추가 전송 옵션이 있어 전송이 차단되었습니다. 원래 요청은 보존됩니다.</p>}
      {state.error && <p className="tool-result-error" role="alert">{state.error}</p>}
      {state.outcome?.status === 'sent' && <p>서비스 확인 번호: {state.outcome.receiptId}</p>}
      {state.refreshWarning && <p role="status">{state.phase === 'sent' ? '서비스에서 전송 완료를 확인했습니다. ' : ''}{state.persistenceWarning ? '로컬 기록을 저장하지 못했습니다. 다시 보내기 전에 서비스에서 결과를 확인해 주세요.' : '화면 기록을 새로 불러오지 못했습니다.'}</p>}
      <footer className="tool-result-footer">
        <div className="tool-result-footer-left">
          <span className="tool-result-status" role="status">{state.phase === 'sent' ? (gmail ? '메일 발송 완료' : 'Slack 게시 완료')
            : state.phase === 'cancelled' ? '전송 요청 취소됨' : state.phase === 'sending' ? '전송 처리 중 · 취소로 회수할 수 없습니다'
              : state.phase === 'unresolved' ? '서비스에서 결과 확인 필요' : '앱을 다시 시작하면 미전송 수정 내용이 사라집니다'}</span>
        </div>
        {!terminal && <div className="tool-result-actions">
          <button type="button" disabled={locked} onClick={() => void controller.cancel(onCancel)}>요청 취소</button>
          {reviewing ? <><button type="button" disabled={locked} onClick={back}>편집으로 돌아가기</button>
            <button ref={confirmButton} type="button" className="tool-result-primary" disabled={locked} onClick={() => void controller.confirm(onConfirm)}>{gmail ? '확인하고 발송' : '확인하고 게시'}</button></>
            : <button ref={reviewButton} type="button" className="tool-result-primary" disabled={locked || preparing || source.blockedFields.length > 0}
              onClick={() => void controller.review()}>
              {preparing ? '계정과 받는 곳 확인 중…' : gmail ? '발송 전 확인' : '게시 전 확인'}
            </button>}
        </div>}
      </footer>
    </section>
  );
}

const noDraftSubscription = () => () => undefined;
const noDraftSnapshot = () => undefined;

export function OutcomeResult({ outcome, refreshWarning, persistenceWarning, executionId }: { outcome: ToolSendOutcome; refreshWarning?: boolean; persistenceWarning?: boolean; executionId?: string }) {
  const controller = cachedToolDraftForExecution(executionId, outcome.binding.provider);
  const state = useSyncExternalStore(controller?.subscribe ?? noDraftSubscription, controller?.getSnapshot ?? noDraftSnapshot, controller?.getSnapshot ?? noDraftSnapshot);
  const tool = outcome.binding.provider;
  const [host, setHost] = useState<{ executionId: string; tool: typeof tool; refreshWarning?: boolean; persistenceWarning?: boolean; failed?: boolean }>();
  useEffect(() => {
    if (!executionId) return;
    let current = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      try {
        const evidence = await window.ax.getToolResult({ executionId });
        if (!current || request !== sequence) return;
        setHost({ executionId, tool, ...(evidence.executionId === executionId
          ? { refreshWarning: evidence.refreshWarning, persistenceWarning: evidence.persistenceWarning } : { failed: true }) });
      } catch {
        if (current && request === sequence) setHost({ executionId, tool, failed: true });
      }
    };
    void load();
    const stop = window.ax.onStateChanged(() => { void load(); });
    return () => { current = false; sequence++; stop(); };
  }, [executionId, tool]);
  const evidence = host && host.executionId === executionId && host.tool === tool ? host : undefined;
  const warning = refreshWarning || state?.refreshWarning || evidence?.refreshWarning;
  const persistenceFailed = persistenceWarning || state?.persistenceWarning || evidence?.persistenceWarning;
  const gmail = outcome.binding.provider === 'gmail';
  const sent = outcome.status === 'sent';
  return <section className="tool-result-pane" aria-label="전송 결과">
    <ToolHeader tool={outcome.binding.provider} title={gmail ? 'Gmail · 전송 결과' : 'Slack · 전송 결과'} badge={sent ? '전송 완료' : '결과 확인 필요'} />
    <p className="tool-result-destination"><span>{outcome.binding.workspaceLabel ? outcome.binding.workspaceLabel + ' · ' + outcome.binding.accountLabel : outcome.binding.accountLabel}</span><strong>{outcome.binding.destinationLabel}</strong></p>
    <p role="status">{sent ? '서비스에서 전송 완료를 확인했습니다.' : '전송 결과를 확인할 수 없습니다. 자동으로 다시 전송하지 않습니다. 서비스에서 결과를 확인해 주세요.'}</p>
    {sent && <p>서비스 확인 번호: {outcome.receiptId}</p>}
    {warning && <p role="status">{persistenceFailed ? '로컬 기록을 저장하지 못했습니다.' : '화면 기록을 새로 불러오지 못했습니다.'} 전송 결과는 유지됩니다. 다시 보내지 말고 서비스에서 결과를 확인해 주세요.</p>}
    {evidence?.failed && <p role="status">전송 기록의 경고 정보를 불러오지 못했습니다. 알려진 전송 결과는 유지됩니다. 서비스에서 확인해 주세요.</p>}
    <small>전송 본문은 이 결과에 저장되지 않았습니다. 서비스에서 확인해 주세요.</small>
  </section>;
}

function PendingMessageResult({ reference, ...actions }: { reference: ToolResultReference } & Omit<ToolResultPaneProps, 'message'>) {
  const [view, setView] = useState<{ controller?: ToolDraftController; outcome?: ToolSendOutcome; refreshWarning?: boolean; persistenceWarning?: boolean; message?: string }>({});
  useEffect(() => {
    let current = true;
    let loadSequence = 0;
    const load = async () => {
      const sequence = ++loadSequence;
      try {
        const data = await window.ax.getToolResult(reference.approvalId);
        if (!current || sequence !== loadSequence) return;
        if (data.outcome) setView(previous => previous.controller && ['sending', 'sent'].includes(previous.controller.getSnapshot().phase)
          ? previous : { outcome: data.outcome, refreshWarning: data.refreshWarning, persistenceWarning: data.persistenceWarning });
        else if (data.source && data.source.approvalId === reference.approvalId && data.source.workspaceSessionId === reference.workspaceSessionId
          && data.source.tool === reference.tool) setView({ controller: cachedToolDraft(data.source, { update: window.ax.updateToolDraft, review: window.ax.reviewToolResult }) });
        else setView({ message: data.cancelled ? '전송 요청이 취소되었습니다.' : data.processing ? '전송 처리 중입니다. 취소로 전송을 회수할 수 없습니다.' : '이 요청은 이미 처리되었습니다. 활동에서 결과를 확인해 주세요.' });
      } catch (error) { if (current && sequence === loadSequence) setView({ message: toolDraftError(error) }); }
    };
    void load();
    const stop = window.ax.onStateChanged(() => { void load(); });
    return () => { current = false; stop(); };
  }, [reference.approvalId, reference.workspaceSessionId, reference.tool]);

  if (view.outcome) return <OutcomeResult outcome={view.outcome} refreshWarning={view.refreshWarning} persistenceWarning={view.persistenceWarning} executionId={reference.executionId} />;
  if (view.controller) return <EditableMessageResult controller={view.controller} {...actions} />;
  return <section className="tool-result-pane" aria-label="결과 불러오기"><ToolHeader tool={reference.tool} title={reference.tool === 'gmail' ? 'Gmail · 메일 초안' : 'Slack · 메시지 초안'} />
    <p role="status">{view.message ?? '기존 초안을 불러오는 중…'}</p></section>;
}

function DatabaseResult({ message }: { message: WorkspaceChatMessage }) {
  const table = message.readResult!;
  const scope = table.readScope!;
  const origin = table.source;
  const brand = origin?.database === 'postgres' ? 'PostgreSQL' : origin?.database === 'mysql' ? 'MySQL' : origin?.database === 'sqlite' ? 'SQLite' : 'DB';
  const verified = origin?.readOnlyEnforced === true && origin.queryFingerprint === scope.queryFingerprint && !!origin.executionId
    && (!message.executionId || message.executionId === origin.executionId);
  return <section className="tool-result-pane tool-result-pane--db" aria-label="DB 조회 결과">
    <ToolHeader tool="rdb" title={brand + ' · 조회 결과'} badge={verified ? '읽기 전용' : '조회 결과 · 검증 정보 없음'} />
    <p className="tool-result-destination"><span>조회 당시 연결</span><strong>{origin?.database ? brand + ' · 연결 이름 미기록' : '이 결과의 연결 정보 없음'}</strong></p>
    <div className="tool-result-table-summary"><h3>{table.name ?? scope.table}</h3><p><strong>{table.rows.length}</strong>행 표시</p>
      <small>현재 조회 페이지 · 전체 데이터 개수는 확인되지 않았습니다.</small></div>
    <div className="tool-result-table-scroll" tabIndex={0} role="region" aria-label="조회 결과 표">
      <table><caption className="tool-result-table-caption">{scope.table} 조회 결과</caption>
        <thead><tr>{table.columns.map(column => <th scope="col" key={column.name}>{column.label ?? column.name}</th>)}</tr></thead>
        <tbody>{table.rows.map(row => <tr key={row.index}>{table.columns.map(column => <td key={column.name}>{row.values[column.name] === null ? <span className="tool-result-null">NULL</span> : String(row.values[column.name] ?? '')}</td>)}</tr>)}</tbody>
      </table>
      {table.rows.length === 0 && <p className="tool-result-empty">이 페이지에서 조회된 행이 없습니다.</p>}
    </div>
    <details className="tool-result-details"><summary>조회 조건 및 SQL 정보</summary>
      <dl><dt>테이블</dt><dd>{scope.table}</dd><dt>조건</dt><dd>조건 필터 없음 · 전체 열</dd><dt>페이지</dt><dd>시작 {scope.offset} · 최대 {scope.limit}행</dd>
        <dt>조회 시점</dt><dd>{origin?.capturedAt ?? '정보 없음'}</dd><dt>조회 식별값</dt><dd>{scope.queryFingerprint}</dd></dl>
      <p>실행 SQL은 이 결과에 포함되지 않았습니다. 직접 SQL 입력과 DB 수정은 지원되지 않습니다.</p>
      {(table.truncated || table.coverage?.hasMore) && <p>추가 페이지가 있습니다. 대화에서 이어서 조회할 수 있습니다.</p>}
      <p>페이지 간 데이터는 바뀔 수 있습니다. 현재 연결 설정이 이 조회 결과의 출처를 바꾸지 않습니다.</p>
    </details>
    <footer className="tool-result-footer"><span>추가 조회와 분석 요청은 대화에서 입력할 수 있습니다.</span></footer>
  </section>;
}

export function ToolResultPane({ message, ...actions }: ToolResultPaneProps) {
  if (message.toolSendOutcome) return <OutcomeResult outcome={message.toolSendOutcome} executionId={message.executionId} />;
  const reference = message.approval?.toolResult;
  if (reference) return <PendingMessageResult key={reference.approvalId} reference={reference} {...actions} />;
  return message.readResult?.readScope ? <DatabaseResult message={message} /> : null;
}
