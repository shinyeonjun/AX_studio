import { describe, expect, it } from 'vitest';
import { buildIRFromWorkflow } from '../canvas/compile/builder.js';
import {
  mergeWorkflowDocument,
  parseStoredWorkflow,
  splitWorkflowIR,
} from '../persisted-document.js';
import { parseWorkflowIR } from '../schema.js';

describe('persisted workflow document round-trip', () => {
  it('migrates the legacy implicit four-read default but preserves explicit budgets', () => {
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
      expect(workflow.steps[0]).not.toHaveProperty('maxReads');
      expect(workflow.steps[1]).toHaveProperty('maxReads', 2);
    }
  });

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

  it('compiles an investigation step without inserting a read budget', () => {
    const ir = buildIRFromWorkflow({
      name: '조사', goal: '필요한 업무 자료 확인', triggerType: 'manual', assumptions: [],
      nodes: [{ type: 'ai_decision', id: 'inspect', goal: '관련 자료를 조사한다', investigation: true }],
    });
    const step = ir.steps?.find((candidate) => candidate.id === 'inspect');

    expect(step).not.toHaveProperty('maxReads');
  });
});
