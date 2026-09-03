import { describe, expect, it } from 'vitest';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../../catalog/dynamic-catalog.js';
import { validateWorkflowContracts } from '../contract-validator.js';
import { folderToDocument } from './fixtures.js';
import type { WorkflowIR } from '../schema.js';

describe('validateWorkflowContracts connector catalog', () => {
  it('rejects an action side effect that disagrees with the catalog contract', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      steps: [
        {
          type: 'action',
          id: 'send_mail',
          connector: 'gmail',
          action: 'message.send',
          actionRef: 'gmail.message.send@1',
          params: { to: 'a@example.com', body: 'notice' },
          sideEffect: 'EXTERNAL',
        },
      ],
      trigger: { type: 'manual' },
      inputs: [],
    };

    expect(validateWorkflowContracts(ir)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_workflow_schema', stepId: 'send_mail' }),
      ]),
    );
  });

  it('rejects external connector actions when the host has no connection', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: 'notice' },
          sideEffect: 'EXTERNAL',
        },
      ],
    };

    expect(validateWorkflowContracts(ir, { connectedConnectors: [] })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'connector_unavailable', stepId: 'notify' }),
      ]),
    );
  });

  it('accepts a connected dynamically registered connector during persistence validation', () => {
    registerDynamicCapabilities([{
      id: 'openapi.alpha.listPets',
      connector: 'openapi',
      kind: 'read',
      label: 'Alpha 반려동물 목록',
      description: 'Alpha 반려동물 목록 조회',
      sideEffect: 'NONE',
      params: [],
    }]);
    const ir: WorkflowIR = {
      id: 'dynamic-wf',
      name: '동적 API 조회',
      goal: '반려동물 목록 조회',
      version: 1,
      trigger: { type: 'manual' },
      steps: [{
        type: 'action',
        id: 'list-pets',
        connector: 'openapi',
        action: 'alpha.listPets',
        params: {},
        sideEffect: 'NONE',
      }],
      inputs: [],
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    try {
      expect(validateWorkflowContracts(ir, { connectedConnectors: ['openapi'] })).toEqual([]);
      expect(validateWorkflowContracts(ir, { runtimeConnectors: {} })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'connector_unavailable', stepId: 'list-pets' }),
        ]),
      );
    } finally {
      clearDynamicCatalogForTests();
    }
  });
});
