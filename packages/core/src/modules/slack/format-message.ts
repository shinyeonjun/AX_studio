import type { FileRef } from '../../contracts/artifacts/file-ref.js';
import type { ConnectorContext } from '../types.js';

const SLACK_HEADER_TEXT_MAX = 150;
const SLACK_SECTION_TEXT_MAX = 3000;
const SLACK_BLOCKS_MAX = 50;

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

export interface MarkdownSection {
  title?: string;
  body: string;
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

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .trim();
}

function truncateSlackText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function chunkMrkdwn(text: string, max = SLACK_SECTION_TEXT_MAX): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= max) return [trimmed];

  const chunks: string[] = [];
  let current = '';

  for (const paragraph of trimmed.split(/\n{2,}/)) {
    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length <= max) {
      current = candidate;
      continue;
    }

    if (current) chunks.push(current);
    if (paragraph.length <= max) {
      current = paragraph;
      continue;
    }

    let rest = paragraph;
    while (rest.length > max) {
      chunks.push(rest.slice(0, max));
      rest = rest.slice(max).trimStart();
    }
    current = rest;
  }

  if (current) chunks.push(current);
  return chunks;
}

export type SlackMessageBlock =
  | { type: 'header'; text: { type: 'plain_text'; text: string; emoji?: boolean } }
  | { type: 'section'; text: { type: 'mrkdwn'; text: string } }
  | { type: 'context'; elements: Array<{ type: 'mrkdwn'; text: string }> };

export interface SlackMessageSource {
  fileName?: string;
  folderLabel?: string;
  engine?: string;
}

export function resolveSlackMessageSource(ctx: ConnectorContext): SlackMessageSource {
  const fileRef = ctx.variables.fileRef;
  const parsedFileRef =
    fileRef && typeof fileRef === 'object' ? (fileRef as Partial<FileRef>) : undefined;

  const fileName =
    (typeof ctx.variables.fileName === 'string' && ctx.variables.fileName.trim()) ||
    (typeof parsedFileRef?.name === 'string' && parsedFileRef.name.trim()) ||
    undefined;

  const folderLabel =
    (typeof ctx.variables.folderLabel === 'string' && ctx.variables.folderLabel.trim()) ||
    (typeof parsedFileRef?.folderId === 'string' && parsedFileRef.folderId.trim()) ||
    undefined;

  const summary = ctx.variables.axDocumentSummary;
  const engine =
    summary &&
    typeof summary === 'object' &&
    typeof (summary as Record<string, unknown>).engine === 'string'
      ? String((summary as Record<string, unknown>).engine)
      : typeof ctx.variables.documentEngine === 'string'
        ? ctx.variables.documentEngine
        : undefined;

  return { fileName, folderLabel, engine };
}

export function formatSlackSourceLine(source: SlackMessageSource): string | undefined {
  const parts: string[] = [];
  if (source.fileName) parts.push(source.fileName);
  if (source.folderLabel) parts.push(source.folderLabel);
  if (source.engine) parts.push(source.engine);
  if (parts.length === 0) return undefined;
  return `_출처 · ${parts.join(' · ')}_`;
}

export function buildSlackBlocks(
  sections: MarkdownSection[],
  sourceLine?: string,
): SlackMessageBlock[] | undefined {
  const titledSections = sections.filter((section) => section.title?.trim());
  if (titledSections.length === 0) return undefined;

  const blocks: SlackMessageBlock[] = [];

  for (const section of sections) {
    if (section.title?.trim()) {
      blocks.push({
        type: 'header',
        text: {
          type: 'plain_text',
          text: truncateSlackText(stripInlineMarkdown(section.title), SLACK_HEADER_TEXT_MAX),
          emoji: true,
        },
      });
    }

    const body = markdownToSlackMrkdwn(section.body);
    for (const chunk of chunkMrkdwn(body)) {
      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: chunk },
      });
    }
  }

  if (sourceLine) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: sourceLine }],
    });
  }

  if (blocks.length > SLACK_BLOCKS_MAX) return undefined;
  return blocks;
}

export interface SlackMessagePayload {
  text: string;
  blocks?: SlackMessageBlock[];
}

export function composeSlackMessagePayload(text: string, ctx: ConnectorContext): SlackMessagePayload {
  const sections = parseMarkdownSections(text);
  const sourceLine = formatSlackSourceLine(resolveSlackMessageSource(ctx));
  const skipSourceInBody = Boolean(sourceLine && text.includes('출처'));
  const blocks = buildSlackBlocks(sections, skipSourceInBody ? undefined : sourceLine);

  if (blocks) {
    const fallbackParts = sections.map((section) => {
      const title = section.title ? `*${stripInlineMarkdown(section.title)}*` : undefined;
      const body = markdownToSlackMrkdwn(section.body);
      return [title, body].filter(Boolean).join('\n');
    });
    const fallbackBody = fallbackParts.filter(Boolean).join('\n\n').trim();
    const fallbackText = skipSourceInBody
      ? fallbackBody
      : sourceLine
        ? `${fallbackBody}\n\n${sourceLine}`
        : fallbackBody;

    return {
      text: fallbackText || markdownToSlackMrkdwn(text),
      blocks,
    };
  }

  return { text: composeSlackMessage(text, ctx) };
}

export function composeSlackMessage(text: string, ctx: ConnectorContext): string {
  const body = markdownToSlackMrkdwn(text);
  const sourceLine = formatSlackSourceLine(resolveSlackMessageSource(ctx));
  if (!sourceLine) return body;
  if (body.includes('출처')) return body;
  return `${body}\n\n${sourceLine}`;
}
