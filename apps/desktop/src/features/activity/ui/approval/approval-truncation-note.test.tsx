import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalTruncationNote, approvalTruncatedFields } from './approval-truncation-note';
import { ToolAwareApproval } from './ToolAwareApproval';

const base = { id: 'approval-1', reason: '외부 작업 승인 필요: slack.message.send', createdAt: '2026-10-06T00:00:00Z', actionIds: ['send'] };

describe('approval truncation note', () => {
  it('renders nothing when no snapshot was shortened', () => {
    expect(renderToStaticMarkup(<ApprovalTruncationNote approval={{ payload: { actionSnapshots: [{ actionId: 'send', params: {} }] } }} />)).toBe('');
    expect(renderToStaticMarkup(<ApprovalTruncationNote approval={{ payload: null }} />)).toBe('');
    expect(renderToStaticMarkup(<ApprovalTruncationNote approval={{}} />)).toBe('');
  });

  it('lists up to three shortened fields with their original length', () => {
    const approval = { payload: { actionSnapshots: [{ actionId: 'send', truncated: true as const, truncatedFields: [
      { path: 'params.body', originalLength: 1234 }, { path: 'to', originalLength: 80 },
      { path: 'cc', originalLength: 70 }, { path: 'bcc', originalLength: 90 },
    ] }] } };
    const markup = renderToStaticMarkup(<ApprovalTruncationNote approval={approval} />);
    expect(markup).toContain('일부만 표시됨');
    expect(markup).toContain('본문 원래 길이 1,234');
    expect(markup).not.toContain('params');
    expect(markup).toContain('외 1개');
    expect(markup).not.toContain('숨은 참조');
  });

  it('still warns when a truncated snapshot carries no field details', () => {
    const approval = { payload: { actionSnapshots: [{ truncated: true as const }] } };
    expect(approvalTruncatedFields(approval)).toHaveLength(1);
    expect(renderToStaticMarkup(<ApprovalTruncationNote approval={approval} />)).toContain('일부만 표시됨');
  });

  it('is shown on the approval card before the request loads', () => {
    const markup = renderToStaticMarkup(<ToolAwareApproval
      approval={{ ...base, payload: { actionSnapshots: [{ actionId: 'send', truncated: true, truncatedFields: [{ path: 'text', originalLength: 900 }] }] } }}
      busy={false} onLegacyAction={vi.fn()} onRefresh={vi.fn()} onOutcome={vi.fn()} />);
    expect(markup).toContain('approval-truncation-note');
    expect(markup).toContain('내용 원래 길이 900');
  });
});
