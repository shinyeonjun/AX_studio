import * as XLSX from 'xlsx';
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAxStudioCore, runAxCommandChat, buildJevReadOperationIndex, buildDesignToolContext } from '../../packages/core/dist/index.js';
import { RdbConnector } from '../../packages/core/dist/connectors/rdb/index.js';
import { HttpConnector } from '../../packages/core/dist/connectors/http/index.js';
import { startLab } from './server.mjs';
import { liveProvider } from './provider.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const live = process.argv.includes('--live');
if (!live && !process.argv.includes('--scripted')) throw new Error('Choose --scripted or --live explicitly');
function option(name, fallback) { const index = process.argv.indexOf(name); return index < 0 ? fallback : Number(process.argv[index + 1]); }
const maxSteps = option('--steps', 6);
const firstStep = option('--from', 0);
if (!Number.isSafeInteger(maxSteps) || maxSteps < 1 || maxSteps > 6 || !Number.isSafeInteger(firstStep) || firstStep < 0 || firstStep > 5) throw new Error('invalid_steps');
const runs = join(dir, 'runs'); mkdirSync(runs, { recursive: true });
const root = mkdtempSync(join(runs, live ? 'live-' : 'scripted-'));
const provider = live ? liveProvider(join(runs, 'provider-budget.json'), option('--max-http', 8)) : undefined;
const lab = await startLab(join(root, 'fixture'));
let fixtureStep = 0;
const choice = choice => ({ type: 'choice', choice, probabilities: { [choice]: 1 } });
const scripted = { dataHandling: 'local', async evaluate(request) {
  const answers = {};
  for (const [id, question] of Object.entries(request.questions)) {
    if (question.type === 'boolean') {
      const candidate = question.instructions?.candidate;
      const selected = [0,5].includes(fixtureStep) && candidate?.kind === 'read' && candidate?.capability_id === 'rdb.query.read'
        && candidate?.label?.includes(fixtureStep === 5 ? 'products' : 'orders');
      answers[id] = { type: 'boolean', probability: selected ? 1 : 0 };
    } else if (question.type === 'choice') {
      let value = 'none';
      if (id === 'route') value = [1,2,3].includes(fixtureStep) ? 'previous_result' : fixtureStep === 4 ? 'answer' : 'capability_read';
      else if (id === 'table_transform') value = fixtureStep === 1 ? 'sort' : fixtureStep === 2 ? 'filter' : fixtureStep === 3 ? 'export_xlsx' : 'none';
      else if (id === 'table_projection') value = 'all_columns';
      else if (id === 'requirements') value = 'met';
      else if (id === 'scope') value = 'preserved';
      else if (id === 'sort_direction') value = 'asc';
      else if (id === 'filter_operator') value = 'neq';
      else if (id.startsWith('sort_column') || id.startsWith('filter_column')) value = Object.entries(question.criteria).find(([,c]) => c?.field === (id.startsWith('sort') ? 'price' : 'status'))?.[0] ?? 'none';
      else if (id === 'filter_value') value = Object.entries(question.criteria).find(([,c]) => c?.value === '취소')?.[0] ?? 'none';
      if (!Object.hasOwn(question.criteria, value)) value = Object.keys(question.criteria)[0];
      answers[id] = choice(value);
    }
  }
  return { answers, model: 'scripted-fixture-NOT-JEV', providerRequestCount: 0, requestBytes: 0 };
} };
const engine = provider?.engine ?? scripted;
let executionDone;
const core = await createAxStudioCore({ dataRoot: join(root, 'app'), decisionEngine: engine, onExecutionFinished(result) { executionDone?.(result); } });
const rdbConfig = { type: 'sqlite', filePath: lab.filePath, allowedTables: ['orders','products','refunds'], rowLimit: 100, label: '합성 주문 상품 환불 DB' };
core.store.setConnection('rdb', true, rdbConfig);
core.runtime.setConnector('rdb', new RdbConnector(rdbConfig));
core.runtime.setConnector('http', new HttpConnector({ id: 'lab', baseUrl: lab.baseUrl, auth: { type: 'none' } }));
const messages = [];
let previousReadResult;
const results = [];
const prompts = ['주문좀 보여줘','이거 싼 순으로 뽑아줘','아 취소된 건 빼고','아까 거 엑셀로 줘','이거 거기로 보내주라','상픔 목록 좀 보여죠'];
const expectedIds = [[1,2,3,4],[2,3,4,1],[3,4,1],null,null,[1,2]];
let generativeCalls = 0;
const harness = { providerName: 'unconfigured', modelName: 'none', async runText() { generativeCalls++; throw new Error('GENERATIVE_MODEL_AUTH_NOT_CONFIGURED'); } };
function filesUnder(path) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesUnder(join(path,entry.name)) : [join(path,entry.name)]);
}
try {
  for (let i = firstStep; i < Math.min(6, firstStep + maxSteps); i++) {
    fixtureStep = i;
    if (i >= 4) { messages.length = 0; previousReadResult = undefined; }
    const selection = buildJevReadOperationIndex(core.store.getConnections()).select(prompts[i]);
    let table; const commands = []; const presentations = []; let error; let reply;
    const before = provider?.metrics.http ?? 0;
    const generativeBefore = generativeCalls;
    const blockedBefore = provider?.metrics.blockedAttempts ?? 0;
    const started = Date.now();
    const workspaceSessionId = core.store.saveWorkspaceChat({ messages: [] }).id;
    let executionResult;
    const execution = new Promise(resolve => { executionDone = resolve; });
    try {
      reply = await runAxCommandChat({ harness, commandService: core.commandService, decisionEngine: engine,
        connectedConnectors: ['rdb'], workspaceSessionId, messages: [...messages], userMessage: prompts[i], previousReadResult,
        readOperationHints: selection.hints, readOperationCatalogSize: selection.totalCount,
        readOperationCatalogMayBeBounded: selection.catalogMayBeBounded, readOperationSelectionMode: selection.mode,
        designToolContextFactory: () => buildDesignToolContext(core.store.getConnections(), ['rdb'], { allowUntrustedData: true, connectors: core.runtime.connectors }),
        onReadResult(value) { table = value; },
        onCommandResult(result, command) { commands.push({ name: command?.name, status: result.status }); },
        onPresentation(value) { presentations.push(value); }, timeoutMs: 30000,
      });
    } catch(e) { error = e.message === 'GENERATIVE_MODEL_AUTH_NOT_CONFIGURED' ? e.message : e.name; }
    if (commands.some(c => c.status === 'queued')) {
      let timer; executionResult = await Promise.race([execution, new Promise(resolve => { timer = setTimeout(() => resolve({status:'timeout'}),5000); })]); clearTimeout(timer);
    }
    const ids = table?.rows.map(row => row.values.id);
    const exportedFiles = filesUnder(join(root, 'app')).filter(path => /\.xlsx?$/i.test(path));
    const exportedMatrix = exportedFiles.length ? XLSX.utils.sheet_to_json(XLSX.read(readFileSync(exportedFiles.at(-1)), {type:'buffer'}).Sheets.Data, {header:1,defval:null}) : undefined;
    const expectedMatrix = previousReadResult ? [previousReadResult.columns.map(c=>c.name), ...previousReadResult.rows.map(r=>previousReadResult.columns.map(c=>r.values[c.name]))] : undefined;
    const verified = expectedIds[i] ? JSON.stringify(ids) === JSON.stringify(expectedIds[i])
      : i === 3 ? executionResult?.status === 'success' && exportedFiles.length > 0 && JSON.stringify(exportedMatrix) === JSON.stringify(expectedMatrix) : !table && !commands.some(c => c.name?.startsWith('execution.') || c.name?.startsWith('workflow.'));
    results.push({ generativeCalls: generativeCalls-generativeBefore, blockedByGenerativeAuth: generativeCalls > generativeBefore, blockedByBatchCap: (provider?.metrics.blockedAttempts ?? 0) > blockedBefore, prompt: prompts[i], mode: live ? 'real-Jev' : 'scripted-fixture', verified,
      ...(ids ? { ids, rows: table.rows.map(row => row.values) } : {}),
      ...(error ? { error } : {}), reply, commands, presentations, exportedFiles, exportedMatrix, executionStatus: executionResult?.status,
      http: (provider?.metrics.http ?? 0)-before, elapsedMs: Date.now()-started });
    if (table) previousReadResult = table;
    messages.push({ role: 'user', content: prompts[i] }, { role: 'assistant', content: reply ?? '검증 중단' });
    console.log(JSON.stringify({ prompt: prompts[i], verified, ids, http: (provider?.metrics.http ?? 0)-before, error }));
    if (provider && (provider.ledger.authBlocked || provider.ledger.used >= 30 || provider.metrics.http >= option('--max-http',8))) break;
  }
} finally {
  const report = { mode: live ? 'real-Jev' : 'scripted-fixture-not-language-evaluation', results, metrics: provider?.metrics, budget: provider?.ledger, fakeOutboxCount: lab.outbox.length, gui: 'blocked-sandbox-not-disabled' };
  report.incomplete = results.filter(r => !r.verified || r.blockedByGenerativeAuth || r.blockedByBatchCap).map(r => ({ prompt: r.prompt, dataVerified: r.verified, reasons: [!r.verified ? (r.prompt === prompts[3] ? 'export_not_verified' : 'result_not_verified') : undefined, r.blockedByGenerativeAuth ? 'generative_auth_unavailable' : undefined, r.blockedByBatchCap ? 'batch_cap' : undefined].filter(Boolean) }));
  if (results.some(r => !r.verified)) process.exitCode = 1;
  writeFileSync(join(root,'result.json'), JSON.stringify(report,null,2));
  console.log('REPORT '+join(root,'result.json'));
  await lab.close(); if(provider) await provider.close(); core.db.close();
}
