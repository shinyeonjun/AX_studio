import { describe, expect, it } from 'vitest';
import { applyStepBindings, inferWorkflowBindings } from './bindings.js';
import type { WorkflowIR } from './schema.js';

describe('inferWorkflowBindings', () => {
  const folderToSlack: WorkflowIR = {
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

  it('binds trigger file to document ingest and chains text to slack', () => {
    const ir = inferWorkflowBindings(folderToSlack);
    expect(ir.steps[0]?.type === 'action' && ir.steps[0].bindings).toEqual({
      source: { from: 'trigger', output: 'file' },
    });
    expect(ir.steps[1]?.type === 'action' && ir.steps[1].bindings).toEqual({
      document: { from: 'ingest', output: 'document' },
    });
    expect(ir.steps[2]?.type === 'action' && ir.steps[2].bindings).toEqual({
      text: { from: 'summarize', output: 'text' },
    });
  });

  it('applies bindings to runtime params', () => {
    const ir = inferWorkflowBindings(folderToSlack);
    const send = ir.steps.find((step) => step.id === 'send');
    if (!send || send.type !== 'action') throw new Error('missing send step');

    const params = applyStepBindings(
      send,
      ir,
      send.params,
      {
        summarize: { text: '요약 결과', kind: 'TextArtifact' },
      },
      {},
    );

    expect(params.text).toBe('요약 결과');
  });
});
