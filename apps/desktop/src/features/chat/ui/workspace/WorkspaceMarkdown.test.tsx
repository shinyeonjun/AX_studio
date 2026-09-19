import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { WorkspaceMarkdown } from './WorkspaceMarkdown';

describe('WorkspaceMarkdown', () => {
  it('wraps Markdown tables in a horizontally scrollable container', () => {
    const html = renderToStaticMarkup(
      <WorkspaceMarkdown content={'| title | price |\n| --- | --- |\n| First | 1.99 |'} />,
    );

    expect(html).toContain('class="ax-workspace-markdown-table"');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>First</td>');
  });
});
