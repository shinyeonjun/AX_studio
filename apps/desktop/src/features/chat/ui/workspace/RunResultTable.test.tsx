import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceChatMessage } from '@ax-studio/core';
import { AssistantMessage } from './ax-workspace-chat/messages';

const table = {
  id: 't', kind: 'table',
  columns: [{ name: 'title', type: 'string', nullable: false, inferred: true }, { name: 'stock', type: 'integer', nullable: false, inferred: true }],
  rows: [{ index: 0, values: { title: 'Apple', stock: 8 } }, { index: 1, values: { title: 'Eggs', stock: 9 } }],
  truncated: false,
  completeness: { status: 'partial', reason: 'provider_limit', observedCount: 30 },
};

const render = (message: Partial<WorkspaceChatMessage>) => renderToStaticMarkup(
  <AssistantMessage message={{ role: 'assistant', content: '실행 완료', ...message } as WorkspaceChatMessage} busy={false} isLatest onSend={vi.fn()} />,
);

describe('run result table', () => {
  it('shows the table a run made, with the page note', () => {
    const markup = render({ kind: 'execution_result', executionId: 'e', executionStatus: 'success', readResult: table as never });
    expect(markup).toContain('<th scope="col">title</th>');
    expect(markup).toContain('<td>Apple</td>');
    expect(markup).toContain('일부(30행)');
  });

  it('says so when no row matched', () => {
    const markup = render({ kind: 'execution_result', executionId: 'e', executionStatus: 'success', readResult: { ...table, rows: [] } as never });
    expect(markup).toContain('조건에 맞는 행이 없습니다.');
  });

  it('is not added to ordinary answers, whose table is in the text', () => {
    expect(render({ readResult: table as never })).not.toContain('ax-run-result-table');
  });
});
