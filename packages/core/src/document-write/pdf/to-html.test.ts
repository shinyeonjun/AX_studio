import { afterEach, describe, expect, it } from 'vitest';
import {
  MockDocumentEngineClient,
  setDocumentEngineClient,
} from '../../document-engine/engine-client.js';
import { importPdfTemplate } from './to-html.js';

describe('importPdfTemplate', () => {
  afterEach(() => {
    setDocumentEngineClient(null);
  });

  it('delegates to document engine client', async () => {
    const client = new MockDocumentEngineClient();
    setDocumentEngineClient(client);
    const result = await importPdfTemplate('/tmp/report.pdf');
    expect(result.templateId).toMatch(/^mock-/);
    expect(result.html).toContain('Mock template');
    expect(result.engine).toBe('mock');
  });
});
