import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  developmentRendererCsp,
  inlineScriptHashes,
  injectCspMeta,
  productionRendererCsp,
} from '../../../electron.vite.config';

const indexHtml = readFileSync(join(__dirname, '../../../src/index.html'), 'utf8');

describe('renderer CSP', () => {
  it('pins the inline theme bootstrap by sha256 and ignores external scripts', () => {
    const body = /<script>([\s\S]*?)<\/script>/.exec(indexHtml)?.[1] ?? '';
    expect(body).toContain('ax-theme');
    const expected = `'sha256-${createHash('sha256').update(body.replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`;
    expect(inlineScriptHashes(indexHtml)).toEqual([expected]);
  });

  it('hashes what the browser hashes: CRLF checkouts match the LF-normalized script', () => {
    const lf = '<script>\n  var a = 1;\n</script>';
    const crlf = lf.replace(/\n/g, '\r\n');
    const browserHash = `'sha256-${createHash('sha256').update('\n  var a = 1;\n', 'utf8').digest('base64')}'`;
    expect(inlineScriptHashes(crlf)).toEqual([browserHash]);
    expect(inlineScriptHashes(lf)).toEqual([browserHash]);
  });

  it('is strict in production', () => {
    const policy = productionRendererCsp(indexHtml);
    expect(policy).toMatch(/^default-src 'self'; script-src 'self' 'sha256-[A-Za-z0-9+/=]+'; /);
    expect(policy).not.toContain('unsafe-eval');
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    for (const directive of ["object-src 'none'", "base-uri 'none'", "frame-src 'none'", "form-action 'none'", "connect-src 'self'"]) {
      expect(policy).toContain(directive);
    }
  });

  it('relaxes only script/connect sources for the Vite dev server', () => {
    const policy = developmentRendererCsp();
    expect(policy).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(policy).toContain('ws://localhost:*');
    expect(policy).toContain("object-src 'none'");
  });

  it('injects the meta tag as the first head child and refuses duplicates', () => {
    const html = injectCspMeta(indexHtml, productionRendererCsp(indexHtml));
    const headStart = html.indexOf('<head>');
    const meta = html.indexOf('http-equiv="Content-Security-Policy"');
    expect(meta).toBeGreaterThan(headStart);
    expect(meta).toBeLessThan(html.indexOf('<script'));
    expect(() => injectCspMeta(html, 'default-src none')).toThrow(/already declares/);
  });
});
