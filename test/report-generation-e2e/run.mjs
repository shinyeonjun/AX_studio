import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CASES, caseById } from './cases.mjs';
import { createBenchmarkPlanner } from './planner.mjs';
import { createPdfPair, createRdbFixture, pythonPath, startOrdersServer } from './fixtures.mjs';

const testDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(testDirectory, '..', '..');
const defaultRoot = process.platform === 'win32'
  ? 'D:\\ax\\_test\\report-generation-e2e'
  : join(tmpdir(), 'ax-report-generation-e2e');

const PDF_TEXT_SCRIPT = String.raw`
import json
import sys
import pypdfium2 as pdfium
from pypdf import PdfReader

path = json.loads(sys.stdin.read())
document = pdfium.PdfDocument(path)
reader = PdfReader(path)
lines = []
texts = []
try:
    for index in range(len(document)):
        page = document[index]
        textpage = page.get_textpage()
        try:
            height = float(reader.pages[index].mediabox.height)
            texts.append(textpage.get_text_bounded())
            chars, boxes = [], []
            def flush():
                if boxes and "".join(chars).strip():
                    lines.append({"page": index, "text": "".join(chars).strip(),
                                  "bbox": [min(b[0] for b in boxes), min(b[1] for b in boxes),
                                           max(b[2] for b in boxes), max(b[3] for b in boxes)]})
                chars.clear()
                boxes.clear()
            for position in range(textpage.count_chars()):
                character = chr(pdfium.raw.FPDFText_GetUnicode(textpage, position))
                if character in "\r\n\x00":
                    flush()
                    continue
                if not character.isspace():
                    left, bottom, right, top = textpage.get_charbox(position)
                    box = (left, height - top, right, height - bottom)
                    size = pdfium.raw.FPDFText_GetFontSize(textpage, position)
                    if boxes and (abs(box[3] - boxes[-1][3]) > size * .5 or box[0] - boxes[-1][2] > size * 1.5):
                        flush()
                    boxes.append(box)
                chars.append(character)
            flush()
        finally:
            textpage.close()
            page.close()
    print(json.dumps({"pageCount": len(document), "text": "\n".join(texts), "lines": lines}, ensure_ascii=False))
finally:
    document.close()
`;

function coreDist(relativePath) {
  return pathToFileURL(join(repositoryRoot, 'packages', 'core', 'dist', relativePath)).href;
}

async function loadCore() {
  const [serviceModule, checkpointModule, engineModule, httpModule, tableModule] = await Promise.all([
    import(coreDist('documents/reporting/service.js')),
    import(coreDist('documents/reporting/checkpoints.js')),
    import(coreDist('documents/read/engine-client/stdio/client.js')),
    import(coreDist('connectors/http/connector.js')),
    import(coreDist('contracts/artifacts/table-build.js')),
  ]);
  return {
    ReportGenerationService: serviceModule.ReportGenerationService,
    ReportCheckpointStore: checkpointModule.ReportCheckpointStore,
    StdioDocumentEngineClient: engineModule.StdioDocumentEngineClient,
    HttpConnector: httpModule.HttpConnector,
    buildTableArtifact: tableModule.buildTableArtifact,
  };
}

function normalizeText(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

export function extractPdfText(path) {
  const result = spawnSync(pythonPath, ['-c', PDF_TEXT_SCRIPT], {
    input: JSON.stringify(path),
    encoding: 'utf8',
    env: { ...process.env, PYTHONUTF8: '1' },
  });
  if (result.status !== 0) {
    throw new Error('pdf_text_extract_failed:' + (result.stderr || result.stdout || 'unknown'));
  }
  return JSON.parse(result.stdout);
}

function artifactSink(root) {
  const directory = join(root, 'artifacts');
  mkdirSync(directory, { recursive: true });
  let count = 0;
  let lastPath;
  return {
    get count() {
      return count;
    },
    get lastPath() {
      return lastPath;
    },
    putBytes(bytes, options) {
      count += 1;
      const fileName = String(options.fileName).replace(/[<>:"/\\|?*\u0000-\u001f]/gu, '_');
      lastPath = join(directory, fileName);
      writeFileSync(lastPath, bytes);
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      return {
        id: options.id ?? 'artifact-' + sha256.slice(0, 16),
        sha256,
        fileName,
        mimeType: options.mimeType,
        size: bytes.byteLength,
        createdAt: new Date().toISOString(),
      };
    },
  };
}

// This oracle verifies the fixed, one-page fixture geometry, not arbitrary PDF layouts.
// Gold values come only from cases.mjs, independently of the production planner.
export function verifyPdf(caseDefinition, textResult) {
  const lines = (textResult.lines ?? []).filter(line => line.page === 0 && normalizeText(line.text));
  const tight = caseDefinition.footer === 'tight';
  const bodyTop = tight ? 225.89 : 160.89;
  const bodyBottom = tight ? 301 : 370;
  const boundaries = [40, 102, 207, 273, 377, 432, 555];
  const body = lines.filter(line => line.bbox[1] >= bodyTop && line.bbox[1] < bodyBottom);
  const grouped = [];
  let invalidGeometry = false;
  for (const line of [...body].sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])) {
    const [x0, y0, x1, y1] = line.bbox;
    const column = boundaries.findIndex((x, index) => index < 6 && x0 >= x - 0.5 && x1 <= boundaries[index + 1] + 0.5);
    if (column < 0 || y1 > bodyBottom) { invalidGeometry = true; continue; }
    let row = grouped.find(item => Math.abs(item.y - y0) <= 2);
    if (!row) { row = { y: y0, cells: Array.from({ length: 6 }, () => []) }; grouped.push(row); }
    row.cells[column].push(line);
  }
  const actualRows = grouped.map(row => row.cells.map(cell => normalizeText(cell.sort((a, b) => a.bbox[0] - b.bbox[0]).map(line => line.text).join(' '))));
  const rows = caseDefinition.targetExpected.rows.map((row, index) => {
    const tokens = [row.id, row.name, row.region, row.revenue, row.orders, row.attainment];
    return { id: row.id, complete: tokens.every((token, column) => actualRows[index]?.[column] === normalizeText(token)), tokens };
  });
  const scalarPositions = [[160, 54.7], [160, 79.7], [400, 79.7], [160, 104.7], [400, 104.7], [160, tight ? 300.5 : 370.5]];
  const atPosition = (value, x, y) => {
    const matches = lines.filter(line => Math.abs(line.bbox[0] - x) <= 2 && Math.abs(line.bbox[1] - y) <= 2);
    return matches.length === 1 && normalizeText(matches[0].text) === normalizeText(value);
  };
  const scalarValuesPresent = caseDefinition.targetExpected.scalars.filter((value, index) => atPosition(value, ...scalarPositions[index])).length;
  const staticTokensPresent = Number(atPosition('AX REPORT E2E', 400, 30.5))
    + Number(atPosition('SOURCE: orders-api + customer-db', 40, tight ? 355.3 : 425.3));
  const exactRows = !invalidGeometry && actualRows.length === rows.length && rows.every(row => row.complete);
  return {
    verificationScope: 'fixed-one-page-fixture-geometry',
    pageCount: textResult.pageCount,
    expectedPageCount: 1,
    expectedScalarCount: caseDefinition.targetExpected.scalars.length,
    scalarValuesPresent,
    scalarCompleteness: scalarValuesPresent / caseDefinition.targetExpected.scalars.length,
    expectedRowCount: rows.length,
    actualRowCount: actualRows.length,
    rowsPresent: rows.filter(row => row.complete).length,
    rowCompleteness: exactRows ? 1 : 0,
    rows,
    actualRows,
    staticTokensPresent,
    staticTokenCount: 2,
    ok: textResult.pageCount === 1 && exactRows
      && scalarValuesPresent === caseDefinition.targetExpected.scalars.length
      && staticTokensPresent === 2,
  };
}

function stageDurations(logs) {
  const durations = {};
  for (const entry of logs) {
    if (entry.code !== 'report_stage_completed') continue;
    const phase = entry.data?.phase;
    const durationMs = entry.data?.durationMs;
    if (typeof phase === 'string' && typeof durationMs === 'number') durations[phase] = durationMs;
  }
  return durations;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
}

function checkVerifierContract() {
  const definition = CASES.find(item => item.expectedOutcome === 'success');
  const keys = ['id', 'name', 'region', 'revenue', 'orders', 'attainment'];
  const xs = [45, 107, 212, 278, 382, 437];
  const scalarPositions = [[160, 55], [160, 80], [400, 80], [160, 105], [400, 105], [160, 371]];
  const line = (text, x, y) => ({ text, bbox: [x, y, x + 20, y + 7], page: 0 });
  const base = [line('AX REPORT E2E', 400, 31), line('SOURCE: orders-api + customer-db', 40, 426),
    ...definition.targetExpected.scalars.map((text, index) => line(text, ...scalarPositions[index]))];
  const make = rows => {
    const lines = [...base, ...rows.flatMap((row, index) => keys.map((key, column) => line(row[key], xs[column], 168.5 + index * 19)))];
    return { pageCount: 1, text: lines.map(item => item.text).join(' '), lines };
  };
  const rows = structuredClone(definition.targetExpected.rows);
  if (!verifyPdf(definition, make(rows)).ok) throw new Error('verifier_rejected_valid_rows');
  const swapped = structuredClone(rows);
  [swapped[0].revenue, swapped[1].revenue] = [swapped[1].revenue, swapped[0].revenue];
  const bag = make(rows);
  bag.lines = [line(bag.text, 45, 168.5)];
  const negatives = {
    'bag-of-tokens': bag,
    'wrong-association': make(swapped),
    'wrong-order': make([...rows].reverse()),
    'duplicate-row': make([...rows, rows[0]]),
    'missing-row': make(rows.slice(1)),
    'extraneous-row': make([...rows, { ...rows[0], id: 'C999' }]),
  };
  const accepted = Object.entries(negatives).filter(([, value]) => verifyPdf(definition, value).ok).map(([name]) => name);
  if (accepted.length) throw new Error('verifier_accepted_invalid:' + accepted.join(','));
}

function checkContract() {
  checkVerifierContract();
  const failures = [];
  if (CASES.length < 10) failures.push('at least ten cases are required');
  if (CASES.filter((item) => item.expectedOutcome === 'success').length < 4) {
    failures.push('at least four positive cases are required');
  }
  if (CASES.filter((item) => item.expectedOutcome === 'failure').length < 5) {
    failures.push('at least five safe-failure cases are required');
  }
  const ids = CASES.map((item) => item.id);
  if (new Set(ids).size !== ids.length) failures.push('case ids must be unique');
  const requiredCategories = [
    'positive-pagination',
    'positive-api-shape',
    'positive-natural-language',
    'positive-order-invariance',
    'safe-failure-pagination-contract',
    'safe-failure-source-completeness',
    'safe-failure-data-integrity',
  ];
  for (const category of requiredCategories) {
    if (!CASES.some((item) => item.category === category)) failures.push('missing category: ' + category);
  }
  for (const item of CASES) {
    if (!item.id || !item.category || !item.goal || !item.exampleExpected || !item.targetExpected) {
      failures.push('missing case contract: ' + item.id);
    }
    if (item.expectedOutcome === 'success' && item.targetExpected.rows.length === 0) {
      failures.push('success case has no target rows: ' + item.id);
    }
    if (item.expectedOutcome === 'failure' && !item.expectedErrorCode) {
      failures.push('failure case has no expected error: ' + item.id);
    }
  }
  if (failures.length) throw new Error('benchmark_contract_failed:' + failures.join('; '));
  console.log(JSON.stringify({
    ok: true,
    caseCount: CASES.length,
    independentGold: true,
    productionCalculationUsedForGold: false,
  }));
}

async function runCase(caseDefinition, root, core) {
  const caseRoot = join(root, caseDefinition.id);
  rmSync(caseRoot, { recursive: true, force: true });
  mkdirSync(caseRoot, { recursive: true });
  const started = Date.now();
  const logs = [];
  let server;
  let result;
  let artifactPath;
  let verification;
  let error;
  let sink;
  let rdb;
  try {
    const fixturePaths = createPdfPair(join(caseRoot, 'input'), caseDefinition);
    server = await startOrdersServer(caseDefinition);
    const http = new core.HttpConnector({
      id: 'orders-api',
      baseUrl: server.baseUrl,
      label: 'Local Orders Fixture',
      auth: { type: 'none' },
    });
    rdb = createRdbFixture(caseDefinition, core.buildTableArtifact);
    sink = artifactSink(caseRoot);
    const documentEngine = new core.StdioDocumentEngineClient({
      artifactRoot: join(caseRoot, 'engine-artifacts'),
      pythonPath,
      timeoutMs: 180_000,
    });
    const checkpoints = new core.ReportCheckpointStore(join(caseRoot, 'checkpoints'));
    const service = new core.ReportGenerationService({
      checkpoints,
      workspaceSources: {
        resolveStoredFile(_sessionId, sourceId) {
          if (sourceId === 'template') return { source: { id: sourceId, fileName: 'template.pdf', mimeType: 'application/pdf' }, artifact: { storedPath: fixturePaths.templatePath } };
          if (sourceId === 'example') return { source: { id: sourceId, fileName: 'example.pdf', mimeType: 'application/pdf' }, artifact: { storedPath: fixturePaths.examplePath } };
          throw new Error('benchmark_source_missing:' + sourceId);
        },
      },
      documentEngine,
      planner: createBenchmarkPlanner(caseDefinition),
      getConnector(name) {
        if (name === 'http') return http;
        if (name === 'rdb') return rdb;
        return undefined;
      },
      makeTemporaryDirectory: () => mkdtempSync(join(caseRoot, 'render-')),
    });
    const context = {
      executionId: 'report-e2e-' + caseDefinition.id,
      workspaceSessionId: 'report-e2e-session',
      variables: {},
      connections: [
        { connector: 'http', connected: true, config: { endpoints: [{ id: 'orders-api', baseUrl: server.baseUrl }] } },
        { connector: 'rdb', connected: true, config: { type: 'fixture', database: 'local' } },
      ],
      artifactSink: sink,
      log(entry) {
        logs.push(entry);
      },
    };
    result = await service.generate({
      goal: caseDefinition.goal,
      templateSourceId: 'template',
      exampleSourceId: 'example',
    }, context);
    artifactPath = sink.lastPath;
    if (result.ok && artifactPath && existsSync(artifactPath)) {
      verification = verifyPdf(caseDefinition, extractPdfText(artifactPath));
    }
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  } finally {
    if (server) await server.close();
  }
  const durationMs = Date.now() - started;
  const actualOk = result?.ok === true;
  const expectedFailure = caseDefinition.expectedOutcome === 'failure';
  const safeFailure = expectedFailure && !actualOk && sink?.count === 0;
  const outputOk = !expectedFailure && actualOk && verification?.ok === true;
  const passed = expectedFailure
    ? safeFailure && (!caseDefinition.expectedErrorCode || result?.errorCode === caseDefinition.expectedErrorCode)
    : outputOk;
  return {
    id: caseDefinition.id,
    description: caseDefinition.description,
    expectedOutcome: caseDefinition.expectedOutcome,
    category: caseDefinition.category,
    goal: caseDefinition.goal,
    expectedErrorCode: caseDefinition.expectedErrorCode,
    passed,
    ok: actualOk,
    error: error ?? result?.error,
    errorCode: result?.errorCode,
    errorDetails: result?.errorDetails,
    durationMs,
    artifactPath,
    artifactCount: sink?.count ?? 0,
    replayPass: actualOk && result.data?.exampleReplayVerified === true,
    verification,
    stageDurations: stageDurations(logs),
    httpRequestCount: server?.requests.length ?? 0,
    httpRequests: server?.requests ?? [],
    rdbQueryPages: rdb?.calls.filter(call => call.action === 'query.read').length ?? 0,
    rdbQueryOffsets: rdb?.calls
      .filter(call => call.action === 'query.read')
      .map(call => call.params?.offset)
      .filter(value => typeof value === 'number') ?? [],
    logs,
  };
}

function buildMetrics(cases) {
  const positive = cases.filter(item => item.expectedOutcome === 'success');
  const negative = cases.filter(item => item.expectedOutcome === 'failure');
  const successful = positive.filter(item => item.ok);
  const completed = positive.filter(item => item.verification);
  const stageValues = {};
  for (const item of cases) {
    for (const [phase, duration] of Object.entries(item.stageDurations)) {
      (stageValues[phase] ??= []).push(duration);
    }
  }
  const latency = (values) => ({
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: Math.max(0, ...values),
  });
  return {
    caseCount: cases.length,
    passedCaseCount: cases.filter(item => item.passed).length,
    positiveCaseCount: positive.length,
    negativeCaseCount: negative.length,
    successfulCaseCount: successful.length,
    safeFailureCaseCount: negative.filter(item => item.passed).length,
    e2eSuccessRate: positive.length ? successful.length / positive.length : 1,
    replayPassRate: positive.length ? positive.filter(item => item.replayPass).length / positive.length : 1,
    outputCompletenessRate: completed.length ? completed.reduce((sum, item) => sum + item.verification.rowCompleteness, 0) / completed.length : 0,
    templateFidelityRate: completed.length ? completed.filter(item => item.verification.pageCount === 1 && item.verification.staticTokensPresent === 2).length / completed.length : 0,
    safeFailureRate: negative.length ? negative.filter(item => item.passed).length / negative.length : 1,
    categories: [...new Set(cases.map((item) => item.category))].sort(),
    latencyMs: latency(cases.map(item => item.durationMs)),
    positiveLatencyMs: latency(positive.map(item => item.durationMs)),
    safeFailureLatencyMs: latency(negative.map(item => item.durationMs)),
    stageLatencyMs: Object.fromEntries(Object.entries(stageValues).map(([phase, values]) => [phase, {
      p50: percentile(values, 0.5),
      p95: percentile(values, 0.95),
    }])),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--check-contract')) {
    checkContract();
    return;
  }
  const caseArgument = args.find(value => value.startsWith('--case='));
  const selected = caseArgument ? caseById(caseArgument.slice('--case='.length)) : undefined;
  if (caseArgument && !selected) throw new Error('unknown_benchmark_case:' + caseArgument);
  const rootArgument = args.find(value => value.startsWith('--root='));
  const root = resolve(rootArgument?.slice('--root='.length) ?? process.env.AX_REPORT_E2E_ROOT ?? defaultRoot);
  mkdirSync(root, { recursive: true });
  const core = await loadCore();
  const definitions = selected ? [selected] : CASES;
  const results = [];
  for (const item of definitions) results.push(await runCase(item, root, core));
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    root,
    cases: results,
    metrics: buildMetrics(results),
  };
  writeFileSync(join(root, 'latest.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.metrics));
  if (results.some(item => !item.passed)) process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exitCode = 1;
});
