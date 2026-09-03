import type { WorkflowIR } from '../../workflow/schema.js';

export function folderWorkflow(trigger?: WorkflowIR['trigger']): WorkflowIR {
  return {
    id: 'wf-1',
    name: 'PDF 요약',
    goal: '요약',
    version: 1,
    trigger,
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
  } as unknown as WorkflowIR;
}
