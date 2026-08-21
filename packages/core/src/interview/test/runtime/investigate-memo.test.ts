import { describe, expect, it } from 'vitest';
import { buildInvestigationUser } from '../../../runtime/ai-investigation.js';

describe('investigate prompt includes memo', () => {
  it('adds criteria block from ai_decision memo', () => {
    const text = buildInvestigationUser(
      {
        type: 'ai_decision',
        id: 'classify',
        goal: 'PDF 위험도 분류',
        memo: 'critical=즉시 대응',
        investigation: false,
        maxReads: 1,
      },
      { variables: {}, executionId: 'exec-1' },
      {},
    );

    expect(text).toContain('Criteria:');
    expect(text).toContain('critical=즉시 대응');
  });
});
