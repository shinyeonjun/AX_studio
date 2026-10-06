import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readTemplateHtml } from './client.js';

describe('readTemplateHtml', () => {
  it('reads an omitted template from inside the template root only', () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-template-root-'));
    const outside = mkdtempSync(join(tmpdir(), 'ax-template-outside-'));
    mkdirSync(join(root, 'ab'), { recursive: true });
    writeFileSync(join(root, 'ab', 'template.html'), '<p>큰 템플릿</p>');
    writeFileSync(join(outside, 'secret.html'), 'secret');

    expect(readTemplateHtml(join(root, 'ab', 'template.html'), root)).toBe('<p>큰 템플릿</p>');
    expect(() => readTemplateHtml(join(outside, 'secret.html'), root)).toThrow('pdf_to_html_path_outside_root');
    expect(() => readTemplateHtml(undefined, root)).toThrow('pdf_to_html_missing_html');
  });
});
