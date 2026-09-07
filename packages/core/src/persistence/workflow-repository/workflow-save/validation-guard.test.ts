import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../db.js';
import { WorkflowStore } from '../../workflow-store.js';
describe('workflow save validation guard', () => {
  it('does not persist an executable workflow with missing action parameters', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    expect(() => store.saveWorkflow({
      id: 'workflow-incomplete',
      name: '미완성 workflow',
      goal: 'Slack에 보내기',
      version: 1,
      trigger: { type: 'manual' },
      steps: [{ type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: { channel: '#ops' }, sideEffect: 'EXTERNAL' }],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    })).toThrow('필요한 데이터 계약을 이전 단계나 트리거가 제공하지 않습니다.');
    expect(store.getWorkflow('workflow-incomplete')).toBeNull();
  });
});
