import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface WorkspaceMarkdownProps {
  content: string;
}

export const WorkspaceMarkdown = memo(function WorkspaceMarkdown({ content }: WorkspaceMarkdownProps) {
  return (
    <div className="ax-workspace-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="ax-workspace-markdown-table">
              <table>{children}</table>
            </div>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
