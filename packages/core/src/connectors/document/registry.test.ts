import { describe, expect, it, vi } from 'vitest';
import type { ConnectorContext } from '../types.js';
import { DocumentConnector } from './connector.js';
import { listDocumentActions } from './registry.js';

describe('document action registry', () => {
  it('preserves the registered read and write action list', () => {
    expect(listDocumentActions()).toEqual([
      'ingest', 'getChunk', 'getPage', 'search',
      'html.render', 'docx.fill', 'pdf.generate', 'pdf.form.analyze', 'pdf.form.fill', 'pdf.toHtml',
    ]);
  });

  it('routes a requested HTML write to its handler', async () => {
    const context: ConnectorContext = {
      executionId: 'test-execution',
      variables: {},
      log: vi.fn(),
    };

    await expect(new DocumentConnector().execute('html.render', {
      template: '<p>{{name}}</p>',
      data: { name: 'Ada' },
    }, context)).resolves.toEqual({ ok: true, data: { html: '<p>Ada</p>' } });
    expect(context.variables.documentHtml).toBe('<p>Ada</p>');
  });

  it('routes every write action to its handler before validating inputs', async () => {
    const context: ConnectorContext = {
      executionId: 'test-execution',
      variables: {},
      log: vi.fn(),
    };
    const connector = new DocumentConnector();

    for (const [action, errorCode] of [
      ['docx.fill', 'template_required'],
      ['pdf.generate', 'html_required'],
      ['pdf.form.analyze', 'local_folder_not_connected'],
      ['pdf.form.fill', 'local_folder_not_connected'],
      ['pdf.toHtml', 'local_folder_not_connected'],
    ] as const) {
      await expect(connector.execute(action, {}, context)).resolves.toMatchObject({
        ok: false,
        errorCode,
      });
    }
  });
});
