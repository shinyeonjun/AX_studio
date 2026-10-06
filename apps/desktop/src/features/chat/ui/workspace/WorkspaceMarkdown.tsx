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

/**
 * GFM autolink literals run until whitespace, so a bare URL followed by JSON punctuation or
 * Korean text (`https://x/rest","status":"404"}입니다`) becomes one long link. Split such a
 * literal at the first character that cannot belong to a URL; the rest renders as text.
 */
export function splitAutolinkLiteral(text: string): { url: string; rest: string } | undefined {
  // URL-safe ASCII only: stops at quotes, braces, angle brackets, backslash and non-ASCII.
  const match = /^https?:\/\/[A-Za-z0-9\-._~:/?#[\]@!$&()*+,;=%]+/.exec(text);
  if (!match) return undefined;
  const url = match[0].replace(/[.,;:!?)\]]+$/, '');
  return url.length < text.length ? { url, rest: text.slice(url.length) } : undefined;
}

function plainText(children: unknown): string | undefined {
  if (typeof children === 'string') return children;
  if (Array.isArray(children) && children.length === 1 && typeof children[0] === 'string') return children[0];
  return undefined;
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
          a: ({ href, children }) => {
            const split = plainText(children)?.startsWith('http') ? splitAutolinkLiteral(plainText(children)!) : undefined;
            if (split) {
              return (
                <>
                  {isAllowedLink(split.url)
                    ? <a href={split.url} target="_blank" rel="noopener noreferrer">{split.url}</a>
                    : <span className="ax-workspace-markdown-link-text">{split.url}</span>}
                  {split.rest}
                </>
              );
            }
            return isAllowedLink(href)
              ? <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
              : <span className="ax-workspace-markdown-link-text">{children}</span>;
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
