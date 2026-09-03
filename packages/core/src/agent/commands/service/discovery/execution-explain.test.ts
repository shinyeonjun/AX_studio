import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { AxCommandService } from '../../service.js';
describe('AxCommandService execution explanation', () => {
  it('explains a result-quality failure without returning raw execution payloads', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const executionId = store.createExecution({
      workflowId: 'workflow-explain',
      workflowVersion: 2,
      ephemeral: true,
      triggerType: 'manual',
      irJson: JSON.stringify({
        id: 'workflow-explain',
        version: 2,
        name: '결과 설명',
        goal: '결과 품질을 설명한다',
        steps: [],
        permissions: {},
        approval: [],
        allowExternalAuto: false,
        assumptions: [],
        sideEffects: {},
        dataPolicy: {},
        outputContract: {
          version: 1,
          fields: [{ path: 'field.customer_count', kind: 'number', required: true, baseline: { sampleCount: 2, numericMin: 80, numericMax: 120, numericToleranceRatio: 0.2 } }],
          inputSchemas: [],
        },
      }),
    });
    store.finishExecution(executionId, 'failed', 'output_contract_failed', [{
      at: new Date().toISOString(),
      level: 'error',
      code: 'output_contract_failed',
      message: '결과 계약을 통과하지 못했습니다.',
      data: { phase: 'before_external_action', issues: [{ code: 'output_volume_anomaly', path: 'field.customer_count', message: '고객 수가 기준 범위를 벗어났습니다.', expected: '80..120 ± 20%', actual: 'number outside baseline range' }] },
    }]);
    const service = new AxCommandService(store);
    const response = await service.execute({ name: 'execution.explain', args: { executionId } });
    expect(response).toMatchObject({
      command: 'execution.explain',
      status: 'ok',
      data: {
        executionId,
        workflowId: 'workflow-explain',
        workflowVersion: 2,
        technicalStatus: 'completed',
        resultStatus: 'failed',
        issues: [{ code: 'output_volume_anomaly', path: 'field.customer_count' }],
      },
    });
    expect(JSON.stringify(response)).not.toContain('raw execution payload');
    expect(JSON.stringify(response)).not.toContain('80,120');
  });
});
