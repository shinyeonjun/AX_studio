import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import * as XLSX from 'xlsx';
import { validateCatalog } from './cases.mjs';
import { buildCatalogForProfile, expectedCaseCount, requiredCaseIds } from './expansion-cases.mjs';

const OWNER_MARKER = 'ax-studio-work-discovery-benchmark-v1';

function json(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sourceSlug(sourceId) {
  return sourceId.replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function snapshotCsv(snapshot) {
  const headers = snapshot.columns.map((column) => column.name);
  const rows = snapshot.rows.map((row) => headers.map((header) => csvCell(row.values[header])).join(','));
  return `${headers.map(csvCell).join(',')}\n${rows.join('\n')}\n`;
}

function sqlIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function snapshotSql(snapshot) {
  const tableName = sqlIdentifier(snapshot.source?.table ?? snapshot.name ?? 'benchmark_table');
  const columnNames = snapshot.columns.map((column) => column.name);
  const columns = columnNames.map(sqlIdentifier);
  const definitions = columnNames.map((column) => `${sqlIdentifier(column)} TEXT`);
  const rows = snapshot.rows.map((row) => `(${columnNames.map((column) => sqlLiteral(row.values[column])).join(', ')})`);
  return [
    `CREATE TABLE ${tableName} (${definitions.join(', ')});`,
    rows.length > 0 ? `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES\n${rows.join(',\n')};` : '',
    '',
  ].join('\n');
}

function pdfEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function simplePdf(text) {
  const stream = `BT /F1 11 Tf 72 720 Td (${pdfEscape(text)}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'binary')} >>\nstream\n${stream}\nendstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, 'binary'));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, 'binary');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, 'binary');
}

function safeSheetName(sourceId, index) {
  const base = String(sourceId).replace(/[:\\/?*\[\]]/g, '_').slice(0, 25) || `Sheet${index + 1}`;
  return base.slice(0, 31);
}

async function writeInputVariants(rawRoot, item, example) {
  const formats = new Set(item.inputFormats ?? []);
  if (formats.has('xlsx')) {
    const workbook = XLSX.utils.book_new();
    Object.entries(example.snapshots).forEach(([sourceId, snapshot], index) => {
      const headers = snapshot.columns.map((column) => column.name);
      const rows = snapshot.rows.map((row) => headers.map((header) => row.values[header]));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...rows]), safeSheetName(sourceId, index));
    });
    await writeFile(join(rawRoot, 'workbook.xlsx'), XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
  }
  for (const [sourceId, snapshot] of Object.entries(example.snapshots)) {
    if (formats.has('postgresql')) {
      await writeFile(join(rawRoot, `${sourceSlug(sourceId)}.sql`), snapshotSql(snapshot), 'utf8');
    }
    if (formats.has('pdf')) {
      await writeFile(join(rawRoot, `${sourceSlug(sourceId)}.pdf`), simplePdf(`${item.id} ${example.id} ${sourceId} ${snapshot.rows.length} rows`));
    }
  }
}

async function writeJson(path, value) {
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, json(value), 'utf8');
}

export async function generateFixtureLab(rootPath, seed = 'wd-v1', profile = 'v1') {
  const root = resolve(rootPath);
  const benchmarkRoot = join(root, 'benchmark', 'v1');
  const casesRoot = join(benchmarkRoot, 'cases');
  const manifestPath = join(benchmarkRoot, 'manifest.json');
  const cases = buildCatalogForProfile(seed, profile);
  validateCatalog(cases, expectedCaseCount(profile), requiredCaseIds(profile));

  try {
    const existingManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (existingManifest.owner !== OWNER_MARKER) throw new Error('benchmark_root_not_owned');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await mkdir(join(root, 'acceptance'), { recursive: true });
  await mkdir(join(root, 'runs'), { recursive: true });
  await mkdir(casesRoot, { recursive: true });

  await writeFile(join(root, 'AX_STUDIO_TEST_LAB.md'), `# AX Studio Test Lab\n\nOwned benchmark data marker: ${OWNER_MARKER}\n\n- Benchmark data: benchmark/v1\n- Final black-box inputs: acceptance\n- Run reports: runs\n- Generated with seed: ${seed}\n- Generated profile: ${profile}\n\nGenerated data is local-only. Do not place credentials or real customer data here.\n`, 'utf8');

  const manifest = {
    owner: OWNER_MARKER,
    schemaVersion: 1,
    benchmark: 'work-discovery',
    version: 'v1',
    seed,
    profile,
    generatedAt: new Date().toISOString(),
    caseIds: cases.map((item) => item.id),
    casesPath: 'cases',
    sideEffects: [],
    networkAccess: false,
  };
  await writeJson(manifestPath, manifest);

  for (const item of cases) {
    const caseRoot = join(casesRoot, item.id);
    await writeJson(join(caseRoot, 'case.json'), item);
    await writeJson(join(caseRoot, 'expected.json'), item.expected);
    for (const example of [...item.examples, ...item.holdout]) {
      const phaseRoot = join(caseRoot, example.phase, example.id, 'snapshots');
      await mkdir(join(caseRoot, example.phase, example.id, 'raw'), { recursive: true });
      for (const [sourceId, snapshot] of Object.entries(example.snapshots)) {
        await writeJson(join(phaseRoot, `${sourceSlug(sourceId)}.json`), snapshot);
        await writeFile(
          join(caseRoot, example.phase, example.id, 'raw', `${sourceSlug(sourceId)}.csv`),
          snapshotCsv(snapshot),
          'utf8',
        );
      }
      await writeInputVariants(join(caseRoot, example.phase, example.id, 'raw'), item, example);
      await writeJson(join(caseRoot, example.phase, example.id, 'expected-output.json'), {
        caseId: item.id,
        exampleId: example.id,
        observations: example.observations,
      });
    }
  }

  return { root, benchmarkRoot, manifest, cases };
}

export async function loadFixtureLab(rootPath) {
  const root = resolve(rootPath);
  const benchmarkRoot = join(root, 'benchmark', 'v1');
  const manifestPath = join(benchmarkRoot, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (manifest.owner !== OWNER_MARKER) throw new Error('benchmark_root_owner_marker_missing');
  const cases = [];
  for (const id of manifest.caseIds) {
    const item = JSON.parse(await readFile(
      join(benchmarkRoot, manifest.casesPath, id, 'case.json'),
      'utf8',
    ));
    cases.push(item);
  }
  const profile = manifest.profile ?? 'v1';
  validateCatalog(cases, expectedCaseCount(profile), requiredCaseIds(profile));
  return { root, benchmarkRoot, manifest, cases };
}

export { OWNER_MARKER };
