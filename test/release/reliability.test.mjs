import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFile, fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { openReadonlySqlJs } from '../../packages/core/dist/persistence/db/sqljs.js';
import { openCore, closeCore, deliveryWorkflow, startHttpFixture, until } from './fixtures.mjs';

// This suite deliberately exercises the fallback backend's deferred durability.
// The packaged application and native document workers have a separate Windows gate.
process.env.AX_DB_BACKEND = 'sqljs';

test('CLI reads do not recover an execution still owned by the running desktop host', { timeout: 20_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-release-cli-observer-'));
  const fixture = await startHttpFixture({ hold: true });
  let core;
  let executing;
  try {
    core = await openCore(root, fixture.baseUrl);
    executing = core.runtime.executeWorkflow(deliveryWorkflow(), { ephemeral: true });
    await until(() => fixture.deliveries.length === 1);
    await promisify(execFile)(process.execPath, [fileURLToPath(new URL('../../packages/core/dist/intelligence/agent/commands/cli.js', import.meta.url)), 'workflow.list'], {
      env: { ...process.env, AX_DATA_ROOT: root }, windowsHide: true, timeout: 10_000,
    });
    const disk = await openReadonlySqlJs(join(root, 'data', 'ax-studio.db'));
    try { assert.equal(disk.all('SELECT status FROM executions')[0]?.status, 'running'); }
    finally { disk.close(); }
    fixture.release();
    assert.equal((await executing).status, 'success');
    assert.equal(fixture.deliveries.length, 1);
  } finally {
    fixture.release(); if (executing) await executing;
    await closeCore(core); await fixture.close(); rmSync(root, { recursive: true, force: true });
  }
});

test('real HTTP: 20 overlapping approval clicks send exactly once and leave a durable receipt', { timeout: 20_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-release-approval-'));
  const fixture = await startHttpFixture({ hold: true });
  let core;
  try {
    core = await openCore(root, fixture.baseUrl);
    const first = await core.runtime.executeWorkflow(deliveryWorkflow({ approval: true }), { ephemeral: true });
    assert.equal(first.status, 'pending_approval');
    assert.equal(fixture.deliveries.length, 0);
    const approvals = Promise.all(Array.from({ length: 20 }, () => core.runtime.continueAfterApproval(first.pendingApprovalId)));
    await until(() => fixture.deliveries.length === 1);
    assert.throws(() => core.store.deleteExecution(first.executionId), /승인 대기/);
    assert.equal(core.store.clearExecutions(), 0);
    fixture.release();
    const results = await approvals;
    assert.equal(results.filter((entry) => entry.status === 'success').length, 1);
    assert.equal(results.filter((entry) => entry.errorCode === 'approval_in_progress' || entry.errorCode === 'approval_already_resolved').length, 19);
    assert.deepEqual(fixture.deliveries, [{ marker: 'release-delivery' }]);
    await closeCore(core); core = undefined;
    core = await openCore(root, fixture.baseUrl);
    assert.equal(core.store.getExecution(first.executionId).status, 'success');
    assert.equal(core.store.getApproval(first.pendingApprovalId).status, 'approved');
    assert.equal((await core.runtime.continueAfterApproval(first.pendingApprovalId)).errorCode, 'approval_already_resolved');
    assert.equal(fixture.deliveries.length, 1);
  } finally {
    fixture.release(); await closeCore(core); await fixture.close(); rmSync(root, { recursive: true, force: true });
  }
});

for (const mode of ['automatic', 'approved']) {
  test(`real process kill: ${mode} HTTP effect is not replayed after restart`, { timeout: 25_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-release-crash-'));
    const fixture = await startHttpFixture({ hold: true });
    let core;
    let child;
    let childExit;
    let diagnostics = '';
    try {
      core = await openCore(root, fixture.baseUrl);
      const workflow = deliveryWorkflow({ approval: mode === 'approved',
        trigger: { type: 'schedule', schedule: '* * * * *', timezone: 'UTC' } });
      core.store.saveWorkflow(workflow);
      core.store.setWorkflowActive(workflow.id, true);
      let approvalId;
      if (mode === 'approved') {
        const pending = await core.runtime.executeWorkflow(workflow, { triggerType: 'manual' });
        assert.equal(pending.status, 'pending_approval');
        approvalId = pending.pendingApprovalId;
      }
      await closeCore(core); core = undefined;
      child = fork(new URL('./crash-worker.mjs', import.meta.url), [root, fixture.baseUrl, ...(approvalId ? [approvalId] : [])], {
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true,
      });
      child.stdout.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-4_000); });
      child.stderr.on('data', (chunk) => { diagnostics = (diagnostics + chunk).slice(-4_000); });
      childExit = once(child, 'exit');
      await until(() => {
        assert.equal(child.exitCode, null, diagnostics);
        return fixture.deliveries.length === 1;
      });
      child.kill('SIGKILL');
      await childExit;
      child = undefined;
      core = await openCore(root, fixture.baseUrl);
      const executions = core.store.listExecutions();
      assert.equal(executions.length, 1);
      assert.equal(executions[0].status, 'failed');
      assert.equal(executions[0].errorCode, 'execution_interrupted');
      assert.ok(JSON.parse(executions[0].logJson).some((entry) => entry.code === 'external_effect_started'));
      assert.equal(core.store.isWorkflowActive(workflow.id), false);
      assert.equal(core.store.getPendingApprovals().length, 0);
      if (approvalId) {
        assert.equal(core.store.getApproval(approvalId).status, 'failed');
        assert.equal((await core.runtime.continueAfterApproval(approvalId)).errorCode, 'approval_already_resolved');
      }
      core.scheduler.start();
      await core.runtime.waitForIdle();
      assert.equal(core.store.listExecutions().length, 1);
      assert.deepEqual(fixture.deliveries, [{ marker: 'release-delivery' }]);
    } finally {
      if (child) { child.kill('SIGKILL'); await childExit; }
      await closeCore(core); await fixture.close(); rmSync(root, { recursive: true, force: true });
    }
  });
}

test('real webhook and HTTP: partial failure remains failed without duplicate delivery after restart', { timeout: 25_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'ax-release-webhook-'));
  const fixture = await startHttpFixture();
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  let core;
  const post = () => fetch(`http://127.0.0.1:${port}/hooks/release`, {
    method: 'POST', headers: { 'x-ax-webhook-secret': 'isolated-release-fixture', 'idempotency-key': 'same-event' }, body: '{"id":1}',
  });
  try {
    core = await openCore(root, fixture.baseUrl);
    const workflow = deliveryWorkflow({ failAfterSend: true, trigger: { type: 'webhook.inbound', path: 'release' } });
    core.store.saveWorkflow(workflow);
    core.store.setWorkflowActive(workflow.id, true);
    core.store.setConnection('webhook', true, { port, secret: 'isolated-release-fixture', secretStored: true });
    core.triggerEngine.start();
    await until(() => core.triggerEngine.pushTransportActive('webhook.inbound'));
    const firstResponse = await post();
    assert.equal(firstResponse.status, 202); await firstResponse.text();
    await until(() => core.store.listExecutions()[0]?.status === 'failed');
    assert.equal(core.store.listExecutions()[0].errorCode, 'http_error');
    assert.equal(fixture.deliveries.length, 1);
    await closeCore(core); core = undefined;
    core = await openCore(root, fixture.baseUrl);
    core.triggerEngine.start();
    await until(() => core.triggerEngine.pushTransportActive('webhook.inbound'));
    const responses = await Promise.all(Array.from({ length: 10 }, post));
    for (const response of responses) { assert.equal(response.status, 202); await response.text(); }
    await core.triggerEngine.stop();
    assert.equal(core.store.listExecutions().length, 1);
    assert.equal(core.store.listExecutions()[0].status, 'failed');
    assert.deepEqual(fixture.deliveries, [{ marker: 'release-delivery' }]);
  } finally { await closeCore(core); await fixture.close(); rmSync(root, { recursive: true, force: true }); }
});
