import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditableToolResult, ToolSendOutcome, WorkspaceChatMessage } from '@ax-studio/core';
import { EditableMessageResult, OutcomeResult, toolResultMessages, ToolResultPane } from './ToolResultPane';
import { cachedToolDraft, clearToolDrafts, ToolDraftController, type ToolDraftApi } from './draft-controller';

afterEach(() => clearToolDrafts('fixture-session'));

function source(tool: 'gmail' | 'slack' = 'gmail'): EditableToolResult {
  return { approvalId: 'fixture-approval', executionId: 'fixture-execution', workspaceSessionId: 'fixture-session', actionId: 'send',
    paramsHash: 'a'.repeat(64), connectionHash: 'b'.repeat(64), connectionRevision: 1, revision: 0, tool, blockedFields: [],
    draft: tool === 'gmail' ? { tool, to: 'known@example.test', subject: 'Known subject', body: 'Human {{literal}} <script>content</script>' }
      : { tool, channel: '#known', text: 'Known Slack message' } };
}
function controller(value = source(), cached = false) {
  const api: ToolDraftApi = { update: async input => ({ ...value, ...input }), review: async input => ({
    confirmation: { approvalId: input.approvalId, workspaceSessionId: input.workspaceSessionId, sealId: '00000000-0000-4000-8000-000000000001' },
    draft: value.draft, revision: input.revision, paramsHash: 'c'.repeat(64),
    binding: value.tool === 'gmail' ? { provider: 'gmail', accountId: 'sender@example.test', accountLabel: 'sender@example.test', destinationId: 'known@example.test', destinationLabel: 'known@example.test' }
      : { provider: 'slack', accountId: 'U12345678', accountLabel: 'Known bot', workspaceId: 'T12345678', workspaceLabel: 'Known workspace', destinationId: 'C12345678', destinationLabel: '#known' },
  }) };
  return cached ? cachedToolDraft(value, api) : new ToolDraftController(value, api);
}
function markup(draft = controller()) {
  return renderToStaticMarkup(<EditableMessageResult controller={draft} busy={false} onCancel={async () => undefined}
    onConfirm={async () => ({ executionId: 'fixture-execution', status: 'failed', log: [] })} />);
}
function dbMessage(): WorkspaceChatMessage {
  return { role: 'assistant', content: 'Fixture table', executionId: 'fixture-read', readResult: {
    id: 'fixture-table', kind: 'table', name: 'fixture_table', truncated: false,
    columns: [{ name: 'name', type: 'string', nullable: true, inferred: false }, { name: 'amount', type: 'integer', nullable: true, inferred: false }],
    rows: [{ index: 0, values: { name: '', amount: null } }, { index: 1, values: { name: '<script>data</script>', amount: 2 } }],
    readScope: { schemaVersion: 1, kind: 'page', queryFingerprint: 'd'.repeat(64), table: 'fixture_table', accessMode: 'read_only', projection: 'all_columns', predicate: 'none', pagination: 'offset', scalarPolicy: 'preserve', offset: 0, limit: 10 },
    coverage: { schemaVersion: 1, page: 'complete', query: 'unknown', source: 'unknown', consistency: 'best_effort', reason: 'independent_offset_reads', observedRows: 2, hasMore: false },
    source: { executionId: 'fixture-read', readOnlyEnforced: true, database: 'postgres', table: 'fixture_table', queryFingerprint: 'd'.repeat(64), capturedAt: '2026-10-02T00:00:00Z' },
  } };
}
const pane = (message: WorkspaceChatMessage) => renderToStaticMarkup(<ToolResultPane message={message} busy={false} onCancel={async () => undefined}
  onConfirm={async () => ({ executionId: 'fixture-execution', status: 'failed', log: [] })} />);

describe('tool result renderers', () => {
  it('renders autofilled, labelled, editable Gmail values as a proposed unsent draft', () => {
    const html = markup();
    expect(html).toContain('Gmail · 메일 초안');
    expect(html).toContain('value="known@example.test"');
    expect(html).toContain('value="Known subject"');
    expect(html).toContain('aria-label="메일 본문"');
    expect(html).toContain('Human {{literal}} &lt;script&gt;content&lt;/script&gt;');
    expect(html).toContain('미전송 초안');
    expect(html).toContain('발송 전 확인');
    expect(html).toContain('첨부 전송은 아직 지원되지 않습니다.');
    expect(html).not.toContain('전송 완료');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('contenteditable');
  });
  it('review displays the verified account, exact destination and explicit confirm/back actions', async () => {
    const draft = controller();
    await draft.review();
    const html = markup(draft);
    expect(html).toContain('sender@example.test');
    expect(html).toContain('known@example.test');
    expect(html).toContain('확인하고 발송');
    expect(html).toContain('편집으로 돌아가기');
    expect(html).toContain('아직 전송되지 않았습니다.');
  });
  it('shows verified Slack workspace, account and stable channel destination', async () => {
    const draft = controller(source('slack'));
    await draft.review();
    const html = markup(draft);
    expect(html).toContain('Slack · 메시지 초안');
    expect(html).toContain('Known workspace · Known bot');
    expect(html).toContain('#known (C12345678)');
    expect(html).toContain('확인하고 게시');
    expect(html).toContain('새 채널 메시지');
  });
  it('keeps thread-targeted intent visible and makes dispatch unavailable', () => {
    const value = source('slack');
    value.blockedFields = ['thread_ts']; value.threadReference = '100.000';
    const html = markup(controller(value));
    expect(html).toContain('스레드 답글 요청');
    expect(html).toContain('100.000');
    expect(html).toContain('전송이 차단되었습니다');
    expect(html).toMatch(/disabled="">게시 전 확인/);
    expect(html).not.toContain('>확인하고 게시<');
  });
  it('renders a semantic read-only DB table with NULL distinct from empty string', () => {
    const html = pane(dbMessage());
    expect(html).toContain('PostgreSQL · 조회 결과');
    expect(html).toContain('>읽기 전용<');
    expect(html).toContain('<td></td>');
    expect(html).toContain('>NULL<');
    expect(html).toContain('&lt;script&gt;data&lt;/script&gt;');
    expect(html).toContain('scope="col"');
    expect(html).toContain('role="region"');
    expect(html).toContain('전체 데이터 개수는 확인되지 않았습니다');
    expect(html).toContain('<details class="tool-result-details">');
    expect(html).not.toContain('<details open');
    expect(html).not.toContain('<textarea');
    expect(html).not.toContain('실행 SQL: SELECT');
  });
  it.each(['fingerprint', 'execution', 'historical'] as const)('does not assert read-only for %s provenance mismatch', kind => {
    const message = dbMessage();
    if (kind === 'fingerprint') message.readResult!.source!.queryFingerprint = 'e'.repeat(64);
    if (kind === 'execution') message.executionId = 'different-read';
    if (kind === 'historical') delete message.readResult!.source;
    const html = pane(message);
    expect(html).not.toContain('>읽기 전용<');
    expect(html).toContain('검증 정보 없음');
  });
  it('keeps empty and truncated pages accurate without inventing totals', () => {
    const message = dbMessage();
    message.readResult!.rows = [];
    message.readResult!.truncated = true;
    message.readResult!.coverage!.hasMore = true;
    const html = pane(message);
    expect(html).toContain('<strong>0</strong>행 표시');
    expect(html).toContain('조회된 행이 없습니다');
    expect(html).toContain('추가 페이지가 있습니다');
    expect(html).not.toContain('총 0');
  });
  it('unknown outcomes show actual destination and no completion or retry action', () => {
    const outcome: ToolSendOutcome = { status: 'unknown', paramsHash: 'c'.repeat(64), binding: {
      provider: 'slack', accountId: 'U12345678', accountLabel: 'Known bot', workspaceId: 'T12345678', workspaceLabel: 'Known workspace', destinationId: 'C12345678', destinationLabel: '#known' } };
    const html = renderToStaticMarkup(<OutcomeResult outcome={outcome} />);
    expect(html).toContain('Known workspace · Known bot');
    expect(html).toContain('#known');
    expect(html).toContain('자동으로 다시 전송하지 않습니다');
    expect(html).not.toContain('전송 완료');
    expect(html).not.toContain('<button');
  });
  it('does not let a failed refresh turn an unknown result into a successful status', async () => {
    const draft = controller();
    await draft.review();
    await draft.confirm(async () => ({ executionId: 'fixture-execution', status: 'failed', log: [], refreshWarning: true }));
    const html = markup(draft);
    expect(html).toContain('결과 확인 필요');
    expect(html).toContain('화면 기록을 새로 불러오지 못했습니다');
    expect(html).not.toContain('서비스에서 전송 완료를 확인했습니다');
  });
  it('keeps earlier unresolved results reachable after an unrelated assistant message', () => {
    const read = dbMessage();
    const messages: WorkspaceChatMessage[] = [read, { role: 'assistant', content: 'Another answer' }];
    expect(toolResultMessages(messages)).toEqual([read]);
    expect(pane({ role: 'assistant', content: 'Unknown tool result' })).toBe('');
  });
  it('shows a known receipt plus failed local persistence and offers no resend', async () => {
    const draft = controller(); await draft.review();
    await draft.confirm(async () => ({ executionId: 'fixture-execution', status: 'failed', log: [], refreshWarning: true,
      errorCode: 'database_persistence_failed', toolSendOutcome: { status: 'sent', receiptId: 'synthetic-receipt', paramsHash: 'c'.repeat(64), binding: {
        provider: 'gmail', accountId: 'sender@example.test', accountLabel: 'sender@example.test', destinationId: 'known@example.test', destinationLabel: 'known@example.test',
      } } }));
    const html = markup(draft);
    expect(html).toContain('서비스에서 전송 완료를 확인했습니다.');
    expect(html).toContain('synthetic-receipt');
    expect(html).toContain('로컬 기록을 저장하지 못했습니다.');
    expect(html).not.toContain('<button');
    expect(html).toContain('disabled=""');
  });
  it('receipt view retains late refresh warnings after the editor is replaced and offers no retry', async () => {
    const draft = controller(source(), true);
    const outcome: ToolSendOutcome = { status: 'sent', receiptId: 'synthetic-receipt', paramsHash: 'c'.repeat(64), binding: {
      provider: 'gmail', accountId: 'sender@example.test', accountLabel: 'sender@example.test', destinationId: 'known@example.test', destinationLabel: 'known@example.test',
    } };
    let complete!: (result: { executionId: string; status: 'success'; log: []; toolSendOutcome: ToolSendOutcome; refreshWarning: boolean }) => void;
    await draft.review();
    const sending = draft.confirm(() => new Promise(resolve => { complete = resolve; }));
    draft.dispose();
    const message: WorkspaceChatMessage = { role: 'assistant', content: 'Synthetic completion', executionId: 'fixture-execution', toolSendOutcome: outcome };
    expect(pane(message)).toContain('synthetic-receipt');
    complete({ executionId: 'fixture-execution', status: 'success', log: [], toolSendOutcome: outcome, refreshWarning: true });
    await sending;
    const html = pane(message);
    expect(html).toContain('서비스에서 전송 완료를 확인했습니다.');
    expect(html).toContain('synthetic-receipt');
    expect(html).toContain('화면 기록을 새로 불러오지 못했습니다.');
    expect(html).toContain('다시 보내지 말고');
    expect(html).not.toContain('<button');
  });
  it.each(['gmail', 'slack'] as const)('retains the returned %s receipt when failed publication leaves the editor mounted', async tool => {
    const draft = controller(source(tool));
    await draft.review();
    const outcome: ToolSendOutcome = { status: 'sent', receiptId: 'retained-' + tool + '-receipt',
      paramsHash: 'c'.repeat(64), binding: draft.getSnapshot().review!.binding };
    let sends = 0;
    await draft.confirm(async () => { sends++; return { executionId: 'fixture-execution', status: 'success', log: [],
      toolSendOutcome: outcome, refreshWarning: true }; });
    outcome.receiptId = 'modified-callback-object';
    const html = markup(draft);
    expect(html).toContain('retained-' + tool + '-receipt');
    expect(html).not.toContain('modified-callback-object');
    expect(html).toContain('화면 기록을 새로 불러오지 못했습니다.');
    expect(html).not.toContain('<button');
    expect(sends).toBe(1);
  });
  it('a cache-empty completion component displays supplied host persistence evidence beside the receipt', () => {
    const outcome: ToolSendOutcome = { status: 'sent', receiptId: 'host-recorded-receipt', paramsHash: 'c'.repeat(64), binding: {
      provider: 'gmail', accountId: 'sender@example.test', accountLabel: 'sender@example.test', destinationId: 'known@example.test', destinationLabel: 'known@example.test',
    } };
    const html = renderToStaticMarkup(<OutcomeResult outcome={outcome} executionId="fixture-execution" refreshWarning persistenceWarning />);
    expect(html).toContain('host-recorded-receipt');
    expect(html).toContain('로컬 기록을 저장하지 못했습니다.');
    expect(html).not.toContain('<button');
  });
});
