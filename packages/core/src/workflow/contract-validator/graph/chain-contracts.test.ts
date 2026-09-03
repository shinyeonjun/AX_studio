import { describe, expect, it } from 'vitest';
import { validateWorkflowContracts } from '../../contract-validator.js';
import { folderToDocument } from '../fixtures.js';
import type { WorkflowIR } from '../../schema.js';

describe('validateWorkflowContracts graph and control flow', () => {
  it('rejects incompatible step chains', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      trigger: { type: 'manual' },
      inputs: [],
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
    };
    const issues = validateWorkflowContracts(ir);
    expect(issues.length).toBe(1);
    expect(issues[0]?.code).toBe('missing_input_contract');
  });
});
