import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface WorkspaceMarkdownProps {
  content: string;
}

export function WorkspaceMarkdown({ content }: WorkspaceMarkdownProps) {
  return (
    <div className="ax-workspace-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
