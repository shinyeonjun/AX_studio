import { describe, expect, it } from 'vitest';
import {
  mergeWorkflowDocument,
  MIGRATED_INVESTIGATION_MAX_READS,
  parseStoredWorkflow,
  splitWorkflowIR,
} from '../persisted-document.js';
import { parseWorkflowIR } from '../schema.js';

describe('persisted workflow document round-trip', () => {
  it('lifts the legacy implicit four-read default to a bounded budget but preserves explicit budgets', () => {
    const base = {
      name: '레거시 조사', goal: '필요한 표 조사', steps: [
        { type: 'ai_decision' as const, id: 'adaptive', goal: '관련 표 조사', investigation: true, maxReads: 4 },
        { type: 'ai_decision' as const, id: 'bounded', goal: '정해진 예산으로 조사', investigation: true, maxReads: 2 },
      ],
    };

    const rawWorkflow = parseStoredWorkflow(base);
    const storedWorkflow = parseStoredWorkflow({
      format: 'workflow-document@1', workflow: base, actions: {},
    });

    for (const workflow of [rawWorkflow, storedWorkflow]) {
      expect(workflow.steps[0]).toHaveProperty('maxReads', MIGRATED_INVESTIGATION_MAX_READS);
      expect(workflow.steps[1]).toHaveProperty('maxReads', 2);
    }
  });

  it('round-trips through stored document format', () => {
    const ir = parseWorkflowIR({
      name: 'PDF',
      goal: '분류',
      version: 1,
      trigger: { type: 'manual' },
      steps: [
        { type: 'action', id: 'ingest', connector: 'document', action: 'ingest', actionRef: 'document.ingest@1',
          params: { path: '/tmp/sample.pdf' }, sideEffect: 'NONE' },
        { type: 'ai_decision', id: 'classify', goal: '위험도 분류', memo: 'critical=긴급' },
      ],
    });
    const stored = splitWorkflowIR(parseWorkflowIR(ir));
    const loaded = mergeWorkflowDocument(stored);
    const reparsed = parseStoredWorkflow(stored);

    const ingest = loaded.steps.find((step) => step.id === 'ingest');
    if (!ingest || ingest.type !== 'action') throw new Error('missing ingest action');
    expect(ingest.params).toMatchObject({
      path: '/tmp/sample.pdf',
    });
    const classify = reparsed.steps.find((step) => step.id === 'classify');
    if (!classify || classify.type !== 'ai_decision') throw new Error('missing classify decision');
    expect(classify.memo).toBe(
      'critical=긴급',
    );
  });
});
