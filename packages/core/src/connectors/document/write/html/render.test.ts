import { describe, expect, it } from 'vitest';
import { htmlRender } from './render.js';
import type { ConnectorContext } from '../../../types.js';

function context(variables: Record<string, unknown>): ConnectorContext {
  return {
    executionId: 'html-render-test',
    variables,
    log: () => undefined,
  };
}

describe('htmlRender', () => {
  it('uses the imported PDF template when no explicit template is supplied', async () => {
    const ctx = context({
      templateHtml: '<html><body><h1>{{title}}</h1></body></html>',
    });

    const result = await htmlRender(
      { title: '양식 기반 보고서', data: {} },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(ctx.variables.documentHtml).toBe(
      '<html><body><h1>양식 기반 보고서</h1></body></html>',
    );
  });

  it('keeps an explicitly supplied template higher priority than the imported form', async () => {
    const ctx = context({
      templateHtml: '<html><body>imported</body></html>',
    });

    const result = await htmlRender(
      {
        template: '<html><body>{{title}}</body></html>',
        title: '명시적 템플릿',
        data: {},
      },
      ctx,
    );

    expect(result.ok).toBe(true);
    expect(ctx.variables.documentHtml).toBe('<html><body>명시적 템플릿</body></html>');
  });
});
