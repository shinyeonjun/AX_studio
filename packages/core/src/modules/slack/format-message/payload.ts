import type { ConnectorContext } from '../../types.js';
import { buildSlackBlocks } from './blocks.js';
import { markdownToSlackMrkdwn, parseMarkdownSections, stripInlineMarkdown } from './markdown.js';
import { formatSlackSourceLine, resolveSlackMessageSource } from './source.js';

export interface SlackMessagePayload {
  text: string;
  blocks?: import('./blocks.js').SlackMessageBlock[];
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
