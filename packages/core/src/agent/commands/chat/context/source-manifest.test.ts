import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import type { StructuredGenerateInput } from '../../../model/provider.js';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
import { runAxCommandChat } from '../../chat.js';
import { scriptedModel } from '../fixtures.js';

describe('runAxCommandChat bounded context', () => {
  it('injects only the current session source manifest into the agent prompt', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const seen: StructuredGenerateInput<unknown>[] = [];
    const harness = new AgentHarness(
      scriptedModel([{ kind: 'reply', message: '자료를 확인했습니다.' }], seen),
    );

    await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: '자료를 확인해줘',
      workspaceSessionId: 'chat-1',
      workspaceSources: [{
        id: 'src_1',
        sessionId: 'chat-1',
        artifactId: 'art_1',
        fileName: 'report.pdf',
        status: 'ready',
        summary: {
          pageCount: 1,
          chunkCount: 1,
          tableCount: 0,
          imageCount: 0,
          visualPageCount: 0,
          visualPages: [],
          engine: 'docling',
        },
        createdAt: '2026-08-24T00:00:00.000Z',
        updatedAt: '2026-08-24T00:00:00.000Z',
      }],
    });

    expect(seen[0]?.system).toContain('session.source.read');
    expect(seen[0]?.system).toContain('report.pdf');
    expect(seen[0]?.system).not.toContain('D:/');
    expect(seen[0]?.system).not.toContain('artifactPath');
  });
});
