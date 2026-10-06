import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sweepEngineTempFiles } from './engine-temp-sweep.js';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('engine temp file sweep', () => {
  it('removes old engine temp files only, keeping outputs and fresh temp files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-sweep-'));
    dirs.push(root);
    const doc = join(root, 'doc_1');
    mkdirSync(doc);
    const old = join(doc, '.chunks.json.abc123.tmp');
    const fresh = join(doc, '.pages.json.def456.tmp');
    const output = join(doc, 'chunks.json');
    const lookalike = join(doc, 'report.tmp');
    for (const file of [old, fresh, output, lookalike]) writeFileSync(file, 'x');
    const twoHoursAgo = (Date.now() - 2 * 60 * 60_000) / 1000;
    for (const file of [old, output, lookalike]) utimesSync(file, twoHoursAgo, twoHoursAgo);

    expect(await sweepEngineTempFiles([root, join(root, 'missing')])).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(output)).toBe(true);
    expect(existsSync(lookalike)).toBe(true);
  });
});
