export interface MarkdownSection {
  title?: string;
  body: string;
}

/** GitHub-style markdown → Slack mrkdwn (chat.postMessage `text`). */
export function markdownToSlackMrkdwn(text: string): string {
  let out = text.replace(/\r\n/g, '\n').trim();
  if (!out) return out;

  out = out.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  out = out.replace(/\*\*(.+?)\*\*/g, '*$1*');
  out = out.replace(/__(.+?)__/g, '_$1_');
  out = out.replace(/^\s*[-*]\s+/gm, '• ');
  out = out.replace(/\n{3,}/g, '\n\n');
  return out.trim();
}

export function parseMarkdownSections(text: string): MarkdownSection[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const sections: MarkdownSection[] = [];
  let current: MarkdownSection = { body: '' };

  for (const line of normalized.split('\n')) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      if (current.title || current.body.trim()) {
        sections.push({ title: current.title, body: current.body.trim() });
      }
      current = { title: headingMatch[2]!.trim(), body: '' };
      continue;
    }
    current.body = current.body ? `${current.body}\n${line}` : line;
  }

  if (current.title || current.body.trim()) {
    sections.push({ title: current.title, body: current.body.trim() });
  }

  return sections;
}

export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .trim();
}
