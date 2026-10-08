/** Local synthetic before/after proof; no provider, connector, credential or user-data access. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import { authoritativeDecisionRequest, createAuthoritativeRequestAnchor } from '../../packages/core/dist/intelligence/decision/request-anchor.js';
import { reportCommand } from '../../packages/core/dist/intelligence/agent/commands/chat/routing/jev-report-selection.js';

const base = '9e993b1a4094d64b8d294b1ca55495a188483ac5';
const root = fileURLToPath(new URL('../..', import.meta.url));
const require = createRequire(import.meta.url);
const source = (path, old) => old
  ? execFileSync('git', ['show', `${base}:${path}`], { cwd: root, encoding: 'utf8' })
  : readFileSync(`${root}/${path}`, 'utf8');
function loadPureModule(path, old, context) {
  const exports = {};
  const code = ts.transpileModule(source(path, old), { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  vm.runInNewContext(code, { exports, structuredClone, require: (id) => {
    if (id.endsWith('/decision/context.js')) return context;
    if (id === 'node:crypto') return require(id);
    throw new Error(`Unexpected runtime import in synthetic proof: ${id}`);
  } }, { filename: path });
  return exports;
}
const oldContext = loadPureModule('packages/core/src/intelligence/decision/context.ts', true);
const oldReport = loadPureModule('packages/core/src/intelligence/agent/commands/chat/routing/jev-report-selection.ts', true, oldContext);
const pendingPath = 'apps/desktop/electron/main/ipc/workspace-chat-command-handlers/pending-command.ts';
const oldPending = loadPureModule(pendingPath, true);
const newPending = loadPureModule(pendingPath, false);
const tail = 'do not send Slack or read unapproved sources.';
const text = `${'x'.repeat(2_049)} ${tail} 😀 한글`;
const anchor = createAuthoritativeRequestAnchor(text);
const packet = authoritativeDecisionRequest({ state: {}, questions: {
  route: { type: 'boolean', instructions: 'Requested?' },
} }, anchor);
const args = { hasWorkspaceSession: true, userMessage: text,
  candidates: ['template', 'example'].map(id => ({ id, fileName: `${id}.pdf`, status: 'ready' })),
  answers: { report_source_role_0: { type: 'choice', choice: 'template', probabilities: { template: 1 } },
    report_source_role_1: { type: 'choice', choice: 'example', probabilities: { example: 1 } } } };
function pendingCollision(module) {
  const original = `${'p'.repeat(2_050)} do not send`;
  const different = `${'p'.repeat(2_050)} send now`;
  const token = module.rememberPendingCommand('synthetic', { name: 'execution.enqueue_once', args: {
    goal: original, steps: [], name: 'Synthetic',
  } }, 1_000);
  module.bindPendingCommandInputRequests('synthetic', token, [{ id: 'value', label: 'Value', type: 'text', required: true }]);
  return module.claimPendingCommand('synthetic', different, ['value'], [{ requestId: 'value', value: 'synthetic' }], 1_001).kind;
}
const results = {
  base,
  originalUtf8Bytes: anchor.utf8Bytes,
  before: { initialRouteRetainsTail: oldContext.boundDecisionString(text).includes(tail),
    finalScopePrefixRetainsTail: oldContext.boundDecisionString(text, 2_000).includes(tail),
    reportGoalRetainsTail: oldReport.reportCommand(args).args.goal.includes(tail),
    samePrefixDifferentPendingIntent: pendingCollision(oldPending) },
  after: { initialRouteRetainsTail: packet.state.request === text,
    reportGoalExact: reportCommand(args).args.goal === text,
    samePrefixDifferentPendingIntent: pendingCollision(newPending) },
};
if (Object.values(results.before).slice(0, 3).some(Boolean) || results.before.samePrefixDifferentPendingIntent !== 'claimed'
  || !results.after.initialRouteRetainsTail || !results.after.reportGoalExact
  || results.after.samePrefixDifferentPendingIntent !== 'mismatch') throw new Error('Unexpected before/after proof result');
process.stdout.write(JSON.stringify(results, null, 2) + '\n');
