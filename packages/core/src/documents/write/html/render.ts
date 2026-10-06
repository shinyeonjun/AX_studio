import Handlebars from 'handlebars';
import type { HtmlRenderInput, HtmlRenderResult } from '../types.js';

/** Default layout: the title and each explicit data field, all HTML-escaped. */
const DEFAULT_TEMPLATE = [
  '<html><body><h1>{{title}}</h1>',
  '{{#each fields}}<section><h2>{{this.label}}</h2><p>{{this.value}}</p></section>{{/each}}',
  '</body></html>',
].join('');

const COMPILE_OPTIONS = { strict: true, knownHelpersOnly: true } as const;

function fieldText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/**
 * Render an HTML document from a Handlebars template. Templates are compiled
 * in strict mode with only the built-in helpers, so a missing field fails
 * loudly instead of rendering blank and no custom helper can be invoked.
 */
export function renderHtml(input: HtmlRenderInput): HtmlRenderResult {
  const title = input.title ?? 'Report';
  if (input.template === undefined) {
    const fields = Object.entries(input.data).map(([label, value]) => ({ label, value: fieldText(value) }));
    return { html: Handlebars.compile(DEFAULT_TEMPLATE, COMPILE_OPTIONS)({ title, fields }) };
  }
  const compiled = Handlebars.compile(input.template, COMPILE_OPTIONS);
  return { html: compiled({ ...input.data, title }) };
}
