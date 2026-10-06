import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { splitAutolinkLiteral, WorkspaceMarkdown } from './WorkspaceMarkdown';

describe('WorkspaceMarkdown', () => {
  it('wraps Markdown tables in a horizontally scrollable container', () => {
    const html = renderToStaticMarkup(
      <WorkspaceMarkdown content={'| title | price |\n| --- | --- |\n| First | 1.99 |'} />,
    );

    expect(html).toContain('class="ax-workspace-markdown-table"');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>First</td>');
  });

  it('never loads remote images and keeps only inline local image data', () => {
    const html = renderToStaticMarkup(
      <WorkspaceMarkdown content={'![tracker](https://example.test/pixel.png) ![plain](http://example.test/a.png) ![local](data:image/png;base64,AAAA)'} />,
    );
    expect(html).not.toContain('example.test');
    expect(html).toContain('[이미지: tracker]');
    expect(html).toContain('[이미지: plain]');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it('renders only https links as new-window anchors and everything else as text', () => {
    const html = renderToStaticMarkup(
      <WorkspaceMarkdown content={'[safe](https://example.test/doc) [insecure](http://example.test) [script](javascript:alert(1)) [file](file:///C:/x)'} />,
    );
    expect(html).toContain('<a href="https://example.test/doc" target="_blank" rel="noopener noreferrer">safe</a>');
    expect(html).not.toContain('href="http://');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('file:');
    expect(html).toContain('insecure');
    expect(html).toContain('script');
  });

  it('ends a bare URL at JSON punctuation or Korean text instead of linking all of it', () => {
    const html = renderToStaticMarkup(
      <WorkspaceMarkdown content={'응답은 https://docs.github.com/rest","status":"404"}입니다'} />,
    );
    expect(html).toContain('<a href="https://docs.github.com/rest" target="_blank" rel="noopener noreferrer">https://docs.github.com/rest</a>');
    expect(html).toContain('&quot;,&quot;status&quot;:&quot;404&quot;}입니다');
    expect(splitAutolinkLiteral('https://example.test/a.')).toEqual({ url: 'https://example.test/a', rest: '.' });
    expect(splitAutolinkLiteral('https://example.test/a')).toBeUndefined();
  });
});
