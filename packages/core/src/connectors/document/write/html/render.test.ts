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

  it('never exposes workflow variables that were not passed as data', async () => {
    const ctx = context({ apiToken: 'secret-token' });
    const defaultResult = await htmlRender({ title: 'T' }, ctx);
    expect(defaultResult.ok).toBe(true);
    expect(String(ctx.variables.documentHtml)).not.toContain('secret-token');

    const templated = await htmlRender({ template: '{{apiToken}}', data: {} }, context({ apiToken: 'secret-token' }));
    expect(templated).toMatchObject({ ok: false, errorCode: 'invalid_params' });
  });

  it('renders explicit data fields escaped in the default template', async () => {
    const ctx = context({});
    await htmlRender({ title: 'T', data: { 금액: '<b>1</b>', count: 2 } }, ctx);
    expect(ctx.variables.documentHtml).toContain('<h2>금액</h2><p>&lt;b&gt;1&lt;/b&gt;</p>');
    expect(ctx.variables.documentHtml).toContain('<h2>count</h2><p>2</p>');
  });

  it('rejects unknown helpers', async () => {
    const result = await htmlRender({ template: '{{custom value}}', data: { value: 1 } }, context({}));
    expect(result).toMatchObject({ ok: false, errorCode: 'invalid_params' });
  });
});
