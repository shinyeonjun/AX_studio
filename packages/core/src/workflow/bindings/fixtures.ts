import type { WorkflowIR } from '../schema.js';

  export const folderToSlack: WorkflowIR = {
    id: 'wf',
    name: 'PDF to Slack',
    goal: '요약 후 전송',
    version: 1,
    trigger: { type: 'local_folder.new_file', folderId: 'folder-1', extensions: ['.pdf'] },
    steps: [
      {
        type: 'action',
        id: 'ingest',
        connector: 'document',
        action: 'ingest',
        params: {},
        sideEffect: 'NONE',
      },
      {
        type: 'action',
        id: 'summarize',
        connector: 'transform',
        action: 'document_to_text',
        params: {},
        sideEffect: 'NONE',
      },
      {
        type: 'action',
        id: 'send',
        connector: 'slack',
        action: 'message.send',
        params: { channel: '#ax' },
        sideEffect: 'EXTERNAL',
      },
    ],
    inputs: ['folderId', 'filePath'],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
  };
