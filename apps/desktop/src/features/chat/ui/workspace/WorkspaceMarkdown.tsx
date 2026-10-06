import { memo } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface WorkspaceMarkdownProps {
  content: string;
}

/** Local, in-memory image sources only; remote images would leak requests from model text. */
function isLocalImageSource(src: unknown): src is string {
  return typeof src === 'string' && (/^data:image\/(png|jpe?g|gif|webp);base64,/i.test(src) || src.startsWith('blob:'));
}

/** Links are only rendered as anchors for https; everything else becomes plain text. */
function isAllowedLink(href: unknown): href is string {
  if (typeof href !== 'string') return false;
  try {
    return new URL(href).protocol === 'https:';
  } catch {
    return false;
  }
}

function urlTransform(url: string, key: string): string {
  // Keep local image sources intact so the img renderer can decide; everything else uses
  // react-markdown's protocol-safe default.
  if (key === 'src' && isLocalImageSource(url)) return url;
  return defaultUrlTransform(url);
}

export const WorkspaceMarkdown = memo(function WorkspaceMarkdown({ content }: WorkspaceMarkdownProps) {
  return (
    <div className="ax-workspace-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          table: ({ children }) => (
            <div className="ax-workspace-markdown-table">
              <table>{children}</table>
            </div>
          ),
          img: ({ src, alt }) => isLocalImageSource(src)
            ? <img src={src} alt={alt ?? ''} />
            : <span className="ax-workspace-markdown-image-blocked">[이미지{alt ? `: ${alt}` : ''}]</span>,
          a: ({ href, children }) => isAllowedLink(href)
            ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
            : <span className="ax-workspace-markdown-link-text">{children}</span>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
