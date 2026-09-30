import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAxStudioCore, runAxCommandChat, buildDesignToolContext } from '../../packages/core/dist/index.js';
import { HttpConnector } from '../../packages/core/dist/connectors/http/index.js';
import { startLab } from './server.mjs';

test('scripted decisions + real HTTP chat: duplicate reads, 503 and in-flight cancellation', async () => {
  const root = mkdtempSync(join(tmpdir(),'ax-chat-lab-'));
  const lab = await startLab(join(root,'fixture'));
  let target='/orders'; let evaluations=0;
  const choice = choice => ({type:'choice',choice,probabilities:{[choice]:1}});
  const engine = { dataHandling:'local', async evaluate(request) {
    evaluations++;
    const answers={};
    for(const [id,q] of Object.entries(request.questions)) {
      if(q.type==='boolean') answers[id]={type:'boolean',probability: q.instructions?.candidate?.id === 'read:op_0' ? 1 : 0};
      else if(q.type==='choice') answers[id]=choice(id==='route'?'capability_read':id==='table_projection'?'all_columns':Object.hasOwn(q.criteria,'none')?'none':Object.keys(q.criteria)[0]);
    }
    return {answers,providerRequestCount:0};
  } };
  const core=await createAxStudioCore({dataRoot:join(root,'app'),decisionEngine:engine});
  const config={id:'lab',baseUrl:lab.baseUrl,auth:{type:'none'}};
  core.store.setConnection('http',true,config);
  core.runtime.setConnector('http',new HttpConnector(config));
  const harness={providerName:'not-configured',modelName:'none',async runText(){throw new Error('generative_auth_unavailable');}};
  async function turn(signal) {
    let table; const results=[];
    const reply=await runAxCommandChat({harness,commandService:core.commandService,decisionEngine:engine,
      userMessage:'합성 API 조회',messages:[],connectedConnectors:['http'],abortSignal:signal,
      readOperationSelectionMode:'full_catalog',
      readOperationHints:[{key:'op_0',connector:'http',capabilityId:'http.request',label:'합성 API',description:'로컬 fixture',params:{connectionId:'lab',method:'GET',path:target}}],
      designToolContextFactory:()=>buildDesignToolContext(core.store.getConnections(),['http'],{allowUntrustedData:true,connectors:core.runtime.connectors}),
      onReadResult(value){table=value;}, onCommandResult(result){results.push({status:result.status});},timeoutMs:3000,
    });
    return {table,results,reply};
  }
  try {
    const first=await turn(); const repeated=await turn();
    assert.deepEqual(first.table?.rows.map(r=>r.values.id),[1,2,3,4], JSON.stringify(first));
    assert.deepEqual(repeated.table.rows.map(r=>r.values),first.table.rows.map(r=>r.values));
    target='/failure'; const failed=await turn(); assert.equal(failed.table,undefined); assert.ok(failed.results.some(r=>r.status!=='ok'));
    target='/delay'; const controller=new AbortController(); const pending=turn(controller.signal);
    const timer=setTimeout(()=>controller.abort(),20);
    const cancelled=await pending.catch(()=>({table:undefined}));clearTimeout(timer);
    assert.equal(controller.signal.aborted,true);assert.equal(cancelled.table,undefined);
    const before=evaluations; const aborted=new AbortController();aborted.abort();await turn(aborted.signal).catch(()=>{});assert.equal(evaluations,before);
    assert.equal(lab.outbox.length,0);
  } finally {await lab.close();core.db.close();rmSync(root,{recursive:true,force:true});}
});

test('replays the real typo ambiguity as a scripted fixture: asks again, never executes or generates', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-chat-unclear-'));
  let evaluations = 0; let generations = 0; let calls = 0;
  const engine = { dataHandling: 'local', async evaluate(request) {
    evaluations++;
    const answers = {};
    for (const [id, q] of Object.entries(request.questions)) {
      if (q.type === 'boolean') answers[id] = { type: 'boolean', probability: id === 'needs_natural_language_answer' ? 0.69 : 0.5 };
      else { const selected = id === 'route' ? 'capability_read' : Object.keys(q.criteria)[0]; answers[id] = { type: 'choice', choice: selected, probabilities: { [selected]: 1 } }; }
    }
    return { answers, providerRequestCount: 0 };
  } };
  const core = await createAxStudioCore({ dataRoot: join(root, 'app'), decisionEngine: engine });
  try {
    const commands = []; const tables = [];
    const reply = await runAxCommandChat({
      harness: { async runText() { generations++; throw new Error('must_not_generate'); } },
      decisionEngine: engine, commandService: { async execute() { calls++; throw new Error('must_not_execute'); } }, userMessage: '상픔 목록 좀 보여죠', messages: [],
      connectedConnectors: ['http'], readOperationSelectionMode: 'full_catalog',
      readOperationHints: [{ key: 'op_0', connector: 'http', capabilityId: 'http.request', label: '상품', description: '합성 상품', params: { method: 'GET', path: '/products', connectionId: 'lab' } }],
      designToolContextFactory: () => buildDesignToolContext([], ['http'], { allowUntrustedData: true, connectors: {} }),
      onReadResult: table => tables.push(table), onCommandResult: result => commands.push(result),
    });
    assert.match(reply, /작업을 실행하지 않았습니다/);
    assert.match(reply, /구체적으로 알려 주세요/);
    assert.deepEqual(commands, []); assert.deepEqual(tables, []);
    assert.equal(generations, 0); assert.equal(calls, 0); assert.equal(evaluations, 1);
  } finally { core.db.close(); rmSync(root, { recursive: true, force: true }); }
});
