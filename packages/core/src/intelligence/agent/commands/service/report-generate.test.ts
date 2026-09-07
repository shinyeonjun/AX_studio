import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../../../persistence/artifact-store.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { WorkspaceSourceService } from '../../../../persistence/workspace-source-service.js';
import { AGENT_COMMAND_CONTEXT } from '../access.js';
import { AxCommandService } from '../service.js';

describe('report.generate command', () => {
  it('queues one host-scoped reversible report action without persisting a workflow', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-command-'));
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const chat = store.saveWorkspaceChat({ messages: [] });
    const now = new Date().toISOString();
    for (const source of [
      { id: 'template', fileName: 'template.pdf' },
      { id: 'example', fileName: 'example.pdf' },
    ]) {
      store.insertWorkspaceSource({
        ...source, sessionId: chat.id, artifactId: `artifact-${source.id}`,
        mimeType: 'application/pdf', status: 'ready', createdAt: now, updatedAt: now,
      });
    }
    const queued: unknown[] = [];
    const service = new AxCommandService(store, {
      workspaceSources: new WorkspaceSourceService(
        store,
        new ArtifactStore(join(root, 'artifacts')),
        join(root, 'sessions'),
      ),
      enqueueOnce: (workflow, options) => {
        queued.push({ workflow, options });
        return { jobId: 'report-job' };
      },
    });

    const response = await service.execute({
      name: 'report.generate',
      args: {
        goal: '다음 달 보고서를 같은 기준과 형식으로 만들어줘',
        templateSourceId: 'template',
        exampleSourceId: 'example',
      },
    }, { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id });

    expect(response).toMatchObject({ command: 'report.generate', status: 'queued', data: { jobId: 'report-job' } });
    expect(queued).toEqual([expect.objectContaining({
      options: { workspaceSessionId: chat.id },
      workflow: expect.objectContaining({
        steps: [expect.objectContaining({
          connector: 'document', action: 'pdf.report.generate', sideEffect: 'REVERSIBLE',
        })],
      }),
    })]);
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('does not resume an earlier report when a fresh user request carries a stale model field', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-report-command-fresh-'));
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const chat = store.saveWorkspaceChat({ messages: [] });
    const now = new Date().toISOString();
    for (const source of [
      { id: 'template', fileName: 'template.pdf' },
      { id: 'example', fileName: 'example.pdf' },
    ]) {
      store.insertWorkspaceSource({
        ...source, sessionId: chat.id, artifactId: `artifact-${source.id}`,
        mimeType: 'application/pdf', status: 'ready', createdAt: now, updatedAt: now,
      });
    }
    const queued: unknown[] = [];
    const service = new AxCommandService(store, {
      workspaceSources: new WorkspaceSourceService(
        store,
        new ArtifactStore(join(root, 'artifacts')),
        join(root, 'sessions'),
      ),
      enqueueOnce: (workflow, options) => {
        queued.push({ workflow, options });
        return { jobId: 'report-job' };
      },
    });

    const response = await service.execute({
      name: 'report.generate',
      args: {
        goal: '다음 기간 보고서를 같은 기준으로 만들어줘',
        templateSourceId: 'template',
        exampleSourceId: 'example',
        resumeExecutionId: 'stale-previous-execution',
      },
    }, {
      executionContext: AGENT_COMMAND_CONTEXT,
      workspaceSessionId: chat.id,
      userMessage: '자료에 있는 양식으로 다음 기간 보고서를 같은 기준과 형식으로 만들어줘',
    });

    expect(response.status).toBe('queued');
    expect(queued[0]).toMatchObject({
      workflow: { steps: [{ params: {
        goal: '다음 기간 보고서를 같은 기준으로 만들어줘',
        templateSourceId: 'template',
        exampleSourceId: 'example',
      } }] },
    });
    expect((queued[0] as { workflow: { steps: Array<{ params: Record<string, unknown> }> } }).workflow.steps[0]?.params)
      .not.toHaveProperty('resumeExecutionId');

    await service.execute({
      name: 'report.generate',
      args: {
        goal: '실패한 보고서의 중간 결과를 이어서 재시도해줘',
        templateSourceId: 'template',
        exampleSourceId: 'example',
        resumeExecutionId: 'explicit-previous-execution',
      },
    }, {
      executionContext: AGENT_COMMAND_CONTEXT,
      workspaceSessionId: chat.id,
      userMessage: '실패한 보고서의 중간 결과를 이어서 재시도해줘',
    });
    expect((queued[1] as { workflow: { steps: Array<{ params: Record<string, unknown> }> } }).workflow.steps[0]?.params)
      .toMatchObject({ resumeExecutionId: 'explicit-previous-execution' });

    await service.execute({
      name: 'report.generate',
      args: {
        goal: '보고서 계속해줘',
        templateSourceId: 'template',
        exampleSourceId: 'example',
        resumeExecutionId: 'ambiguous-previous-execution',
      },
    }, {
      executionContext: AGENT_COMMAND_CONTEXT,
      workspaceSessionId: chat.id,
      userMessage: '보고서 계속해줘',
    });
    expect((queued[2] as { workflow: { steps: Array<{ params: Record<string, unknown> }> } }).workflow.steps[0]?.params)
      .not.toHaveProperty('resumeExecutionId');

    await service.execute({
      name: 'report.generate',
      args: {
        goal: 'direct host caller retry',
        templateSourceId: 'template',
        exampleSourceId: 'example',
        resumeExecutionId: 'direct-previous-execution',
      },
    }, { executionContext: AGENT_COMMAND_CONTEXT, workspaceSessionId: chat.id });
    expect((queued[3] as { workflow: { steps: Array<{ params: Record<string, unknown> }> } }).workflow.steps[0]?.params)
      .toMatchObject({ resumeExecutionId: 'direct-previous-execution' });
  });
});
