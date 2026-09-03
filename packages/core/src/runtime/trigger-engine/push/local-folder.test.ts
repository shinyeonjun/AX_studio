import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../engine.js';
import { createTestConnectors, mockLocalFolder, mockSlack } from '../../../modules/test-connectors.js';
import { TriggerEngine } from '../../trigger-engine.js';
import type { WorkflowIR } from '../../../workflow/schema.js';

describe('TriggerEngine local-folder push transport', () => {
  it('fires once for each new file', async () => {
    const folderWorkflow: WorkflowIR = {
      name: '새 PDF 요약',
      goal: '폴더에 PDF가 생기면 요약',
      version: 1,
      trigger: { type: 'local_folder.new_file', folderId: 'folder-inbox', extensions: ['.pdf'] },
      inputs: ['filePath', 'fileName'],
      steps: [{
        type: 'action',
        id: 'notify',
        connector: 'slack',
        action: 'message.send',
        params: { channel: '#docs', text: 'new file' },
        sideEffect: 'EXTERNAL',
      }],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    mockLocalFolder(runtime.connectors).files['folder-inbox'] = ['/mock/inbox/existing.pdf'];

    const { workflowId } = store.saveWorkflow(folderWorkflow);
    store.setWorkflowActive(workflowId, true);
    const engine = new TriggerEngine(store, runtime);

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(0);

    mockLocalFolder(runtime.connectors).files['folder-inbox'].push('/mock/inbox/report.pdf');
    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);

    await engine.tick();
    expect(mockSlack(runtime.connectors).messages).toHaveLength(1);
  });
});
