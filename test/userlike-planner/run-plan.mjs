import * as XLSX from 'xlsx';
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAxStudioCore } from '../../packages/core/dist/application/bootstrap.js';
import { planJevSelectedTools } from '../../packages/core/dist/intelligence/agent/commands/chat/jev-workflow-plan.js';
import { TRANSFORM_CAPABILITIES } from '../../packages/core/dist/connectors/transform/catalog.js';
import { RdbConnector } from '../../packages/core/dist/connectors/rdb/index.js';
import { startLab } from './server.mjs';
import { liveProvider } from './provider.mjs';

if (!process.argv.includes('--live') && !process.argv.includes('--scripted')) throw new Error('Explicit mode required');
const live = process.argv.includes('--live');
const xlsx = process.argv.includes('--xlsx');
const runs = join(dirname(fileURLToPath(import.meta.url)), 'runs'); mkdirSync(runs, { recursive: true });
const root = mkdtempSync(join(runs, live ? 'plan-live-' : 'plan-scripted-'));
const provider = live ? liveProvider(join(runs,'provider-budget.json'),3) : undefined;
const choice = choice => ({ type: 'choice', choice, probabilities: { [choice]: 1 } });
const engine = provider?.engine ?? { dataHandling: 'local', async evaluate() { return { answers: { requirements: choice('met'), scope: choice('preserved') }, providerRequestCount: 0, requestBytes: 0 }; } };
const lab = await startLab(join(root,'fixture'));
let complete;
const finished = new Promise(resolve => { complete = resolve; });
const core = await createAxStudioCore({ dataRoot: join(root,'app'), decisionEngine: engine, onExecutionFinished: complete });
const config = { type: 'sqlite', filePath: lab.filePath, allowedTables: ['orders'], rowLimit: 100 };
core.store.setConnection('rdb',true,config);
core.runtime.setConnector('rdb',new RdbConnector(config));
const actual = [];
for (const name of ['rdb','transform']) {
  const connector = core.runtime.connectors[name];
  core.runtime.setConnector(name,{ name, async execute(action,params,context) {
    const result = await connector.execute(action,params,context);
    actual.push({ connector: name, action, ok: result.ok, data: result.ok ? result.data : undefined });
    return result;
  } });
}
const report = { mode: live ? 'real-Jev-module-assembly' : 'scripted-module-assembly', verified: false };
try {
  const plan = await planJevSelectedTools({ decisionEngine: engine,
    request: xlsx ? '선택한 DB 조회 결과 표를 Excel 파일로 저장해줘.' : '선택한 DB 조회 결과 표를 텍스트로 변환해줘.', mode:'one_shot', connectedConnectors:['rdb'],
    readOperationHints:[{key:'orders',capabilityId:'rdb.query.read',connector:'rdb',label:'합성 주문 DB 조회',description:'허용된 주문 테이블 조회',params:{table:'orders'}}],
    actionHints:[{key:'text',capability:TRANSFORM_CAPABILITIES.find(c=>c.id===(xlsx ? 'transform.table_to_xlsx' : 'transform.table_to_text'))}],
  });
  report.planKind=plan.kind; report.telemetry=plan.telemetry; report.presentation=plan.presentation;
  if(plan.kind==='command') {
    const result=await core.commandService.execute(plan.command,{executionContext:{origin:'agent'}});
    report.commandStatus=result.status;
    if(result.status==='queued') {
      let timer;
      const execution=await Promise.race([finished,new Promise(resolve=>{timer=setTimeout(()=>resolve({status:'timeout'}),5000)})]);
      clearTimeout(timer); report.executionStatus=execution.status;
      const table=actual.find(r=>r.connector==='rdb')?.data;
      const text=actual.find(r=>r.connector==='transform')?.data;
      report.rowIds=table?.rows?.map(r=>r.values.id);
      report.textOutput=text;
      if (xlsx && execution.status === 'success') {
        const walk = path => readdirSync(path, {withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(path,e.name)):[join(path,e.name)]);
        const file = walk(join(root,'app')).find(path=>path.endsWith('.xlsx'));
        report.xlsxFile = file;
        const matrix = file ? XLSX.utils.sheet_to_json(XLSX.read(readFileSync(file), {type:'buffer'}).Sheets.Data, {header:1,defval:null}) : undefined;
        report.exportedRows = matrix;
        report.verified = JSON.stringify(matrix) === JSON.stringify([table.columns.map(c=>c.name), ...table.rows.map(r=>table.columns.map(c=>r.values[c.name]))]);
      } else report.verified=execution.status==='success' && JSON.stringify(report.rowIds)==='[1,2,3,4]' && text?.text === [table.columns.map(c=>c.name).join('\t'), ...table.rows.map(r=>table.columns.map(c=>String(r.values[c.name] ?? '')).join('\t'))].join('\n');
    } else report.issues=result.issues?.map(i=>i.code);
  } else report.message=plan.message;
} finally {
  if (!report.verified) process.exitCode=1;
  report.metrics=provider?.metrics; report.budget=provider?.ledger;
  writeFileSync(join(root,'result.json'),JSON.stringify(report,null,2)); console.log(JSON.stringify(report));
  console.log('REPORT '+join(root,'result.json')); await lab.close(); if(provider)await provider.close(); core.db.close();
}
