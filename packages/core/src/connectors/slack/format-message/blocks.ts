import type { MarkdownSection } from './markdown.js';
import { markdownToSlackMrkdwn, stripInlineMarkdown } from './markdown.js';

const SLACK_HEADER_TEXT_MAX = 150;
const SLACK_SECTION_TEXT_MAX = 3000;
const SLACK_BLOCKS_MAX = 50;

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
