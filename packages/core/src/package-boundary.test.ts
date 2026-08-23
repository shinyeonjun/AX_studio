import { describe, it, expect } from 'vitest';
import { parseWorkflowIR } from './workflow/schema.js';
import { requiresApproval, validateApprovalPolicy } from './workflow/approval.js';
import { csMailWorkflowFixture } from './testing/fixtures/workflows.js';
import { createDatabaseAsync } from './store/db.js';
import { WorkflowStore } from './store/workflow-store.js';
import packageJson from '../package.json';

describe('core package boundary', () => {
  it('has no electron or react in dependencies', () => {
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    expect(deps.electron).toBeUndefined();
    expect(deps.react).toBeUndefined();
  });

  it('gmail.send approval is enforced by the action boundary', () => {
    const bad = {
      ...csMailWorkflowFixture,
      steps: csMailWorkflowFixture.steps.filter((s) => s.type !== 'human_approval'),
    };
    expect(validateApprovalPolicy(bad)).toEqual([]);
    expect(requiresApproval('EXTERNAL_HIGH', true)).toBe(true);
  });

  it('store roundtrip', async () => {
    const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
    const { workflowId } = store.saveWorkflow(parseWorkflowIR(csMailWorkflowFixture));
    expect(store.getWorkflow(workflowId)?.name).toBe('고객 문의 처리');
  });
});
