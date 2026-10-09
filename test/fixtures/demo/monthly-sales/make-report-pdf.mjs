// The PDF version of the demo's monthly report: last month's to hand to the report feature, and
// the true next month's to compare its result with. Run: node test/fixtures/demo/monthly-sales/make-report-pdf.mjs
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { report } from './report.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..', '..');
const venv = join(repo, 'packages', 'document-engine', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(venv) ? venv : process.platform === 'win32' ? 'python' : 'python3';

function orders(path) {
  const book = XLSX.readFile(path);
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
}

const scratch = mkdtempSync(join(tmpdir(), 'ax-demo-report-'));
try {
  for (const [period, input, output] of [
    ['2026-08', join(here, 'input', '주문내역_2026-08.xlsx'), join(here, 'output', '월간매출보고서_2026-08.pdf')],
    ['2026-09', join(here, 'next-month', '주문내역_2026-09.xlsx'), join(here, 'expected', '월간매출보고서_2026-09.pdf')],
  ]) {
    const json = join(scratch, `${period}.json`);
    writeFileSync(json, JSON.stringify(report(period, orders(input))));
    const drawn = spawnSync(python, [join(here, 'draw-report-pdf.py'), json, output], { encoding: 'utf8' });
    if (drawn.status !== 0) throw new Error(drawn.stderr || `draw-report-pdf failed for ${period}`);
    console.log(output);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
