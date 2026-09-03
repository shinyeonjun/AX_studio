import { describe, expect, it } from 'vitest';
import { applyStepBindings, inferWorkflowBindings } from '../bindings.js';
import { folderToSlack } from './fixtures.js';

describe('inferWorkflowBindings folder to Slack', () => {
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

  it('replaces a legacy static ingest path with the current folder event file', () => {
    const legacy = {
      ...folderToSlack,
      steps: folderToSlack.steps.map((step) =>
        step.id === 'ingest' && step.type === 'action'
          ? { ...step, params: { path: 'D:/old/removed.pdf' } }
          : step,
      ),
    } satisfies WorkflowIR;

    const ir = inferWorkflowBindings(legacy);
    const ingest = ir.steps.find((step) => step.id === 'ingest');
    if (!ingest || ingest.type !== 'action') throw new Error('missing ingest step');

    expect(ingest.bindings).toMatchObject({
      source: { from: 'trigger', output: 'file' },
    });

    const params = applyStepBindings(
      ingest,
      ir,
      ingest.params,
      {},
      {
        fileRef: {
          sourceId: 'local_folder',
          folderId: 'folder-1',
          path: 'D:/connected/incoming.pdf',
          name: 'incoming.pdf',
        },
      },
    );

    expect(params.path).toBeUndefined();
    expect(params.file).toMatchObject({ path: 'D:/connected/incoming.pdf' });
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
