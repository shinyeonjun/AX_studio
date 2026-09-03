import { describe, expect, it } from 'vitest';
import { buildIRFromWorkflow } from '../canvas/compile/builder.js';
import {
  mergeWorkflowDocument,
  parseStoredWorkflow,
  splitWorkflowIR,
} from '../persisted-document.js';
import { parseWorkflowIR } from '../schema.js';

describe('persisted workflow document round-trip', () => {
  it('round-trips through stored document format', () => {
    const draft = {
      name: 'PDF',
      goal: '분류',
      triggerType: 'manual' as const,
      assumptions: [],
      nodes: [
        {
          type: 'action' as const,
          id: 'ingest',
          actionRef: 'document.ingest@1',
        },
        {
          type: 'ai_decision' as const,
          id: 'classify',
          goal: '위험도 분류',
          memo: 'critical=긴급',
        },
      ],
      actions: {
        ingest: {
          actionRef: 'document.ingest@1',
          params: { path: '/tmp/sample.pdf' },
        },
      },
    };

    const ir = buildIRFromWorkflow(draft);
    const stored = splitWorkflowIR(parseWorkflowIR(ir));
    const loaded = mergeWorkflowDocument(stored);
    const reparsed = parseStoredWorkflow(stored);

    expect(loaded.steps.find((step) => step.id === 'ingest' && step.type === 'action')?.params).toMatchObject({
      path: '/tmp/sample.pdf',
    });
    expect(reparsed.steps.find((step) => step.id === 'classify' && step.type === 'ai_decision')?.memo).toBe(
      'critical=긴급',
    );
  });
});
