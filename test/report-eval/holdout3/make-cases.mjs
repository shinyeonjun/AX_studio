// Third held-out set: expense claim files for the connected folder, last month's report as PDF and Word,
// and this month's as the answer. Run: node test/report-eval/holdout3/make-cases.mjs <dataFolder> [outDir]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expenses } from './data.mjs';
import { shapes } from './shapes.mjs';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..', '..');
const venv = join(repo, 'packages', 'document-engine', '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(venv) ? venv : 'python';
const dataFolder = resolve(process.argv[2] ?? 'D:/AX_demo/월간매출');
const out = resolve(process.argv[3] ?? 'D:/AX_eval_holdout3');

const months = { example: ['2026-08', 81], expected: ['2026-09', 9157] };
const models = {};
for (const [role, [period, seed]] of Object.entries(months)) {
  const rows = expenses(period, seed);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), '경비청구');
  XLSX.writeFile(book, join(dataFolder, `경비청구_${period}.xlsx`));
  models[role] = shapes(period, rows);
  mkdirSync(join(out, role), { recursive: true });
}
const cases = [];
for (const id of Object.keys(models.example)) {
  for (const format of ['pdf', 'docx']) {
    for (const role of ['example', 'expected']) {
      const model = join(out, role, `${id}.json`);
      writeFileSync(model, JSON.stringify(models[role][id]));
      const drawn = spawnSync(python, [join(here, '..', 'render.py'), model, join(out, role, `${id}.${format}`)], { encoding: 'utf8' });
      if (drawn.status !== 0) throw new Error(drawn.stderr);
    }
    cases.push({ id: `${id}-${format}`, example: join(out, 'example', `${id}.${format}`),
      expected: join(out, 'expected', `${id}.${format}`), goal: '첨부한 8월 보고서 보고 9월 보고서 써줘' });
  }
}
writeFileSync(join(out, 'cases.json'), JSON.stringify(cases, null, 2));
console.log(`${cases.length} held-out cases → ${join(out, 'cases.json')}`);
