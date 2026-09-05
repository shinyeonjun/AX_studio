import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../../store/artifact-store.js';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkspaceSourceService } from '../../../store/workspace-source-service.js';
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
});
