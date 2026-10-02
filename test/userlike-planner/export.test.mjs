import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as XLSX from 'xlsx';
import { createAxStudioCore, runAxCommandChat } from '../../packages/core/dist/index.js';

test('scripted Jev export uses real runtime storage, preserves untrusted cells and publishes a downloadable artifact only after success', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-export-lab-'));
  let finish; let failStorage = false; let rejectReview = false;
  const choice = choice => ({ type: 'choice', choice, probabilities: { [choice]: 1 } });
  const requests = [];
  const engine = { dataHandling: 'local', async evaluate(request) {
    requests.push(request);
    const answers = {};
    for (const [id, q] of Object.entries(request.questions)) {
      answers[id] = q.type === 'boolean' ? { type: 'boolean', probability: 0 } : choice(
        ({ route: 'previous_result', table_transform: 'export_xlsx', requirements: rejectReview ? 'missing' : 'met', scope: 'preserved' })[id]
          ?? (Object.hasOwn(q.criteria, 'none') ? 'none' : Object.keys(q.criteria)[0]));
    }
    return { answers, providerRequestCount: 0 };
  } };
  const core = await createAxStudioCore({ dataRoot: root, decisionEngine: engine, onExecutionFinished(result) { finish?.(result); } });
  const connector = core.runtime.connectors.transform;
  core.runtime.setConnector('transform', { name: 'transform', execute(action, params, ctx) {
    return connector.execute(action, params, failStorage ? { ...ctx, artifactSink: { putBytes() { throw new Error('synthetic failure'); } } } : ctx);
  } });
  const table = { id: 'previous', kind: 'table', columns: [{ name: 'id', type: 'integer' }, { name: 'name', type: 'string' }],
    rows: [{ index: 0, values: { id: 3, name: '{{trigger.secret}}' } }, { index: 1, values: { id: 4, name: '=SUM(1,2)' } }, { index: 2, values: { id: 1, name: '노트' } }], truncated: true };
  const files = path => readdirSync(path, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(path, e.name)) : [join(path, e.name)]);
  async function turn(signal) {
    const session = core.store.saveWorkspaceChat({ messages: [] });
    const commands = []; let timer;
    const done = new Promise(resolve => { finish = resolve; });
    const reply = await runAxCommandChat({ decisionEngine: engine, commandService: core.commandService,
      harness: { async runText() { throw new Error('generation forbidden'); } },
      userMessage: '아까 거 엑셀로 줘', messages: [], previousReadResult: table, connectedConnectors: [], workspaceSessionId: session.id,
      abortSignal: signal, onCommandResult(result) { commands.push(result); },
    });
    const execution = commands.some(c => c.status === 'queued') ? await Promise.race([done, new Promise(resolve => { timer = setTimeout(() => resolve({ status: 'timeout' }), 5000); })]) : undefined;
    clearTimeout(timer);
    return { reply, commands, execution, messages: core.store.getWorkspaceChat(session.id).messages };
  }
  try {
    const result = await turn(); assert.equal(result.execution?.status, 'success', JSON.stringify(result));
    const xlsx = files(root).filter(p => p.endsWith('.xlsx')); assert.equal(xlsx.length, 1);
    const workbook = XLSX.read(readFileSync(xlsx[0]), { type: 'buffer' });
    assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets.Data, { header: 1 }), [['id', 'name'], [3, '{{trigger.secret}}'], [4, '=SUM(1,2)'], [1, '노트']]);
    const delivery = result.messages.find(m => m.generatedSpreadsheet)?.generatedSpreadsheet;
    assert.ok(delivery?.artifactId); assert.equal(delivery.fileName, 'table.xlsx'); assert.equal(delivery.path, undefined);
    assert.equal(JSON.stringify(requests.filter(r => r.questions.requirements)).includes('{{trigger.secret}}'), false);
    assert.equal((await turn()).execution.status, 'success'); assert.equal(files(root).filter(p => p.endsWith('.xlsx')).length, 1);
    failStorage = true;
    const failed = await turn(); assert.equal(failed.execution.status, 'failed'); assert.ok(!failed.messages.some(m => m.generatedSpreadsheet));
    failStorage = false; rejectReview = true;
    const stopped = await turn(); assert.equal(stopped.commands.length, 0); assert.match(stopped.reply, /확인/);
    const controller = new AbortController(); controller.abort(); const before = requests.length;
    await turn(controller.signal).catch(() => {}); assert.equal(requests.length, before);
    assert.equal(files(root).filter(p => p.endsWith('.xlsx')).length, 1);
  } finally { core.db.close(); rmSync(root, { recursive: true, force: true }); }
});
