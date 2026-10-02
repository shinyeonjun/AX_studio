import { AxJobProposeArgsSchema } from '../job-registration/contract.js';
import { validateProposeInput } from '../job-registration/propose/input.js';
import { candidateFromCreateCommand } from '../workflow-gateway/steps.js';
import { AxWorkflowCreateArgsSchema } from '../schema/workflow-args.js';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../../../persistence/artifact-store.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { WorkspaceSourceService } from '../../../../persistence/workspace-source-service.js';
import type { WorkflowIR } from '../../../../workflow/schema.js';
import { createAuthoritativeRequestAnchor } from '../../../decision/request-anchor.js';
import { AGENT_COMMAND_CONTEXT } from '../access.js';
import { AxCommandService } from '../service.js';
import { runAxCommandChat } from '../chat.js';
import type { DecisionAnswer, DecisionEngine, DecisionEvaluationResult } from '../../../../contracts/decision.js';

const choice = (value: string): DecisionAnswer => ({ type: 'choice', choice: value, probabilities: { [value]: 1 } });

describe('versioned exact report goals through the real service', () => {
  it('queues and snapshots the complete goal, preserves its anchor on retry, and leaves old snapshots legacy', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-exact-report-goal-'));
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const chat = store.saveWorkspaceChat({ messages: [] });
    for (const id of ['template', 'example']) store.insertWorkspaceSource({ id, sessionId: chat.id,
      artifactId: id, fileName: `${id}.pdf`, mimeType: 'application/pdf', status: 'ready', createdAt: '', updatedAt: '' });
    const sources = new WorkspaceSourceService(store, new ArtifactStore(join(root, 'artifacts')), join(root, 'sessions'));
    const queued: WorkflowIR[] = [];
    const service = new AxCommandService(store, { workspaceSources: sources, enqueueOnce: (workflow) => {
      queued.push(workflow); return { jobId: 'synthetic-report' };
    } });
    const text = `  Generate the next PDF report ${'x'.repeat(2_050)}. Do not read Gmail or send Slack. 😀\n`;
    const engine: DecisionEngine = { evaluate: async ({ questions }): Promise<DecisionEvaluationResult> => ({ answers: questions.route
      ? { route: choice('report_generate') }
      : { report_source_role_0: choice('template'), report_source_role_1: choice('example') } }) };
    await runAxCommandChat({ messages: [], userMessage: text, requestId: 'original-turn', connectionRevision: 3,
      workspaceSessionId: chat.id, commandService: service, decisionEngine: engine, resolveWorkspaceSources: () => sources.list(chat.id),
      harness: { providerName: 'synthetic', modelName: 'synthetic', runText: async () => { throw new Error('Prose should not be needed to plan a report.'); } } });
    const anchor = createAuthoritativeRequestAnchor(text, { originalRequestId: 'original-turn', workspaceSessionId: chat.id, catalogRevision: 3 });
    expect(queued).toHaveLength(1); expect(queued[0]).toMatchObject({ goal: text, requestAnchor: anchor,
      steps: [{ params: { goal: text, requestAnchor: anchor } }] });
    const originalSnapshot = JSON.stringify(queued[0]);
    const execution = store.createExecution({ ephemeral: true, workspaceSessionId: chat.id, irJson: originalSnapshot });
    store.finishExecution(execution, 'failed', 'synthetic_failure');
    await service.execute({ name: 'report.generate', args: { goal: 'retry', resumeExecutionId: execution,
      requestAnchor: createAuthoritativeRequestAnchor('retry'), templateSourceId: 'template', exampleSourceId: 'example' } },
      { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id, userMessage: 'retry' });
    expect(queued[1]).toMatchObject({ goal: text, requestAnchor: anchor, steps: [{ params: { goal: text, requestAnchor: anchor, resumeExecutionId: execution } }] });
    expect(store.getExecution(execution)?.irJson).toBe(originalSnapshot);
    const legacy = structuredClone(queued[0]!); delete legacy.requestAnchor;
    if (legacy.steps[0]?.type !== 'action') throw new Error('expected report action');
    delete legacy.steps[0].params.requestAnchor; legacy.goal = 'old bounded goal'; legacy.steps[0].params.goal = legacy.goal;
    const oldSnapshot = JSON.stringify(legacy);
    const oldExecution = store.createExecution({ ephemeral: true, workspaceSessionId: chat.id, irJson: oldSnapshot });
    store.finishExecution(oldExecution, 'failed', 'synthetic_failure');
    await service.execute({ name: 'report.generate', args: { goal: 'retry', resumeExecutionId: oldExecution,
      templateSourceId: 'template', exampleSourceId: 'example' } },
      { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id, userMessage: 'retry' });
    expect(queued[2]?.goal).toBe('old bounded goal'); expect(queued[2]).not.toHaveProperty('requestAnchor');
    expect(queued[2]?.steps[0]).not.toHaveProperty('params.requestAnchor'); expect(store.getExecution(oldExecution)?.irJson).toBe(oldSnapshot);
    const tampered = await service.execute({ name: 'report.generate', args: { goal: text + ' send now', requestAnchor: anchor,
      templateSourceId: 'template', exampleSourceId: 'example' } }, { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id });
    expect(tampered.status).toBe('invalid'); expect(queued).toHaveLength(3);
  });
});


describe('new exact goals and legacy command compatibility', () => {
  it('permits complete anchored job goals without reinterpreting old unanchored bounds', () => {
    const text = 'j'.repeat(2_050) + ' do not send Slack';
    const anchor = createAuthoritativeRequestAnchor(text);
    const args = { name: 'Synthetic', goal: text };
    expect(AxJobProposeArgsSchema.safeParse(args).success).toBe(false);
    expect(AxJobProposeArgsSchema.safeParse({ ...args, requestAnchor: anchor }).success).toBe(true);
    const bad = validateProposeInput({ ...args, requestAnchor: { ...anchor, digest: 'sha256:' + '0'.repeat(64) } }, 'chat');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.response[0]).toBe('invalid');
    const exact = '  Complete goal with whitespace 😀\n';
    const candidate = candidateFromCreateCommand({ name: 'workflow.create', args: { name: 'New', goal: exact,
      requestAnchor: createAuthoritativeRequestAnchor(exact) } }, AxWorkflowCreateArgsSchema);
    expect(candidate).toMatchObject({ ok: true, value: { goal: exact, requestAnchor: { text: exact } } });
    const legacy = candidateFromCreateCommand({ name: 'workflow.create', args: { name: 'Old', goal: '  old goal  ' } }, AxWorkflowCreateArgsSchema);
    expect(legacy).toMatchObject({ ok: true, value: { goal: 'old goal' } });
    if (legacy.ok) expect(legacy.value).not.toHaveProperty('requestAnchor');
  });
});
