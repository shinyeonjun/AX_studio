import Handlebars from 'handlebars';
import type { HtmlRenderInput, HtmlRenderResult } from '../types.js';

const DEFAULT_TEMPLATE =
  '<html><body><h1>{{title}}</h1><pre>{{json}}</pre></body></html>';

export function renderHtml(input: HtmlRenderInput): HtmlRenderResult {
  const template = input.template ?? DEFAULT_TEMPLATE;
  const compiled = Handlebars.compile(template);
  const html = compiled({
    ...input.data,
    json: JSON.stringify(input.data, null, 2),
    title: input.title ?? 'Report',
  });
  return { html };
}
