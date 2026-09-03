import type { WorkflowIR } from '../schema.js';

export const folderToDocument: WorkflowIR = {
  id: 'wf',
  name: 'PDF',
  goal: '요약',
  version: 1,
  trigger: { type: 'local_folder.new_file', folderId: 'folder-1', extensions: ['.pdf'] },
  steps: [
    {
      type: 'action',
      id: 'ingest',
      connector: 'document',
      action: 'ingest',
      params: { path: '{{filePath}}' },
      sideEffect: 'NONE',
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
