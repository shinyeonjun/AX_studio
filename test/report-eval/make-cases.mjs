// Writes last month's report (the example handed to AX Studio) and this month's (the answer) for
// every shape, as PDF and Word, plus cases.json for AX_REPORT_EVAL.
// Run: node test/report-eval/make-cases.mjs [outDir]   (default D:/AX_eval)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shapes } from './shapes.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const demo = join(repo, 'test', 'fixtures', 'demo', 'monthly-sales');
const venv = join(repo, 'packages', 'document-engine', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(venv) ? venv : 'python';
const out = resolve(process.argv[2] ?? 'D:/AX_eval');

function orders(path) {
  const book = XLSX.readFile(path);
  return XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]]);
}

const months = {
  example: shapes('2026-08', orders(join(demo, 'input', '주문내역_2026-08.xlsx'))),
  expected: shapes('2026-09', orders(join(demo, 'next-month', '주문내역_2026-09.xlsx'))),
};
const cases = [];
for (const role of ['example', 'expected']) mkdirSync(join(out, role), { recursive: true });
for (const id of Object.keys(months.example)) {
  for (const format of ['pdf', 'docx']) {
    for (const [role, models] of Object.entries(months)) {
      const model = join(out, role, `${id}.json`);
      writeFileSync(model, JSON.stringify(models[id]));
      const file = join(out, role, `${id}.${format}`);
      const drawn = spawnSync(python, [join(here, 'render.py'), model, file], { encoding: 'utf8' });
      if (drawn.status !== 0) throw new Error(drawn.stderr || `render failed: ${file}`);
    }
    cases.push({ id: `${id}-${format}`, example: join(out, 'example', `${id}.${format}`),
      expected: join(out, 'expected', `${id}.${format}`), goal: '8월 보고서야. 9월 걸로 써 줘' });
  }
}
writeFileSync(join(out, 'cases.json'), JSON.stringify(cases, null, 2));
console.log(`${cases.length} cases → ${join(out, 'cases.json')}`);
