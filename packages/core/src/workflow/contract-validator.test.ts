import { describe, expect, it } from 'vitest';
import { contractTypesCompatible, canSatisfyInput } from '../contracts/compatibility.js';
import {
  documentIngestParamsFromFileRef,
  fileRefFromTriggerPayload,
  resolveDocumentIngestParams,
} from '../contracts/mappers.js';
import { validateWorkflowContracts } from './contract-validator.js';
import { inferWorkflowBindings } from './bindings.js';
import type { WorkflowIR } from './schema.js';
import { clearDynamicCatalogForTests, registerDynamicCapabilities } from '../catalog/dynamic-catalog.js';

describe('contract compatibility', () => {
  it('allows FileRef to satisfy DocumentIngestInput', () => {
    expect(contractTypesCompatible('FileRef', 'DocumentIngestInput')).toBe(true);
    expect(canSatisfyInput(['FileRef'], 'DocumentIngestInput')).toBe(true);
  });

  it('rejects unrelated contracts', () => {
    expect(contractTypesCompatible('SlackMessageRef', 'DocumentIngestInput')).toBe(false);
  });
});

describe('contract mappers', () => {
  it('maps trigger payload to FileRef and ingest params', () => {
    const file = fileRefFromTriggerPayload({
      folderId: 'folder-1',
      filePath: 'D:\\docs\\sample.pdf',
      fileName: 'sample.pdf',
      extension: '.pdf',
    });
    expect(file?.path).toBe('D:\\docs\\sample.pdf');
    expect(documentIngestParamsFromFileRef(file!)).toEqual({
      file: expect.objectContaining({ path: 'D:\\docs\\sample.pdf' }),
    });
  });

  it('resolves document ingest input from execution variables', () => {
    const params = resolveDocumentIngestParams(
      { path: '{{filePath}}' },
      { filePath: 'C:\\inbox\\doc.pdf', fileName: 'doc.pdf' },
    );
    expect(params.file).toEqual(expect.objectContaining({ path: 'C:\\inbox\\doc.pdf' }));
    expect(params.path).toBeUndefined();
  });
});

describe('validateWorkflowContracts', () => {
  const folderToDocument: WorkflowIR = {
    id: 'wf',
    name: 'PDF',
    goal: '요약',
    version: 1,
    trigger: { type: 'local_folder.new_file', folderId: 'folder-1', extensions: ['.pdf'] },
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
    inputs: ['folderId', 'filePath'],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    assumptions: [],
    sideEffects: {},
    dataPolicy: {},
  };

  it('accepts local folder trigger feeding document ingest', () => {
    expect(validateWorkflowContracts(folderToDocument)).toEqual([]);
  });

  it('accepts manual workflows with concrete ingest path', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'action',
          id: 'ingest',
          connector: 'document',
          action: 'ingest',
          params: { path: 'C:\\fixed\\doc.pdf' },
          sideEffect: 'NONE',
        },
      ],
      inputs: [],
    };
    expect(validateWorkflowContracts(ir)).toEqual([]);
  });

  it('rejects a configured trigger whose required value is empty', () => {
    const cases: WorkflowIR['trigger'][] = [
      { type: 'schedule', schedule: '', timezone: 'Asia/Seoul' },
      { type: 'schedule', schedule: '0 9 * * *', timezone: '' },
      { type: 'once', runAt: '' },
      { type: 'gmail.new_message', accountId: '' },
      { type: 'slack.new_message', channel: '' },
      { type: 'local_folder.new_file', folderId: '' },
    ];

    for (const trigger of cases) {
      const issues = validateWorkflowContracts({ ...folderToDocument, trigger });
      expect(issues.some((issue) => issue.code === 'invalid_workflow_schema')).toBe(true);
    }
  });

  it('rejects an invalid schedule expression instead of saving a never-running workflow', () => {
    const issues = validateWorkflowContracts({
      ...folderToDocument,
      trigger: { type: 'schedule', schedule: 'every Friday', timezone: 'Asia/Seoul' },
    });
    expect(issues.some((issue) => issue.code === 'invalid_workflow_schema')).toBe(true);
  });

  it('rejects an invalid schedule timezone instead of saving a never-running workflow', () => {
    const issues = validateWorkflowContracts({
      ...folderToDocument,
      trigger: { type: 'schedule', schedule: '0 9 * * *', timezone: 'Mars/Olympus' },
    });
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'invalid_workflow_schema',
      message: 'schedule timezone이 올바르지 않습니다: Mars/Olympus',
    }));
  });

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

  it('rejects steps after IF when only one branch produces required contracts', () => {
    const ir: WorkflowIR = {
      id: 'wf-if',
      name: 'Branching',
      goal: 'test',
      version: 1,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'action',
          id: 'read_sheet',
          connector: 'local_sheet',
          action: 'read',
          params: { path: './data.csv' },
          sideEffect: 'NONE',
        },
        {
          type: 'if',
          id: 'branch',
          condition: 'true',
          thenStepIds: ['to_text'],
          elseStepIds: [],
        },
        {
          type: 'action',
          id: 'to_text',
          connector: 'transform',
          action: 'table_to_text',
          params: {},
          sideEffect: 'NONE',
        },
        {
          type: 'action',
          id: 'send',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops' },
          sideEffect: 'EXTERNAL',
        },
      ],
      inputs: [],
      permissions: {},
      approval: [],
      allowExternalAuto: true,
      assumptions: [],
      sideEffects: {},
      dataPolicy: {},
    };

    const adapted = inferWorkflowBindings(ir);
    const issues = validateWorkflowContracts(adapted);
    expect(issues.some((issue) => issue.stepId === 'send')).toBe(true);
  });

  it('rejects references to undeclared AI output fields', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '위험도 분류',
          outputSchema: {
            type: 'object',
            properties: { riskLevel: { type: 'string' } },
            required: ['riskLevel'],
          },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: '{{classify.summary}}' },
          sideEffect: 'EXTERNAL',
        },
      ],
      inputs: [],
      trigger: { type: 'manual' },
    };

    expect(validateWorkflowContracts(ir).some((issue) => issue.code === 'invalid_workflow_reference')).toBe(true);
  });

  it('rejects AI output references when the decision has no output schema', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '위험도 분류',
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops', text: '{{classify.riskLevel}}' },
          sideEffect: 'EXTERNAL',
        },
      ],
      inputs: [],
      trigger: { type: 'manual' },
    };

    expect(validateWorkflowContracts(ir)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_workflow_reference', stepId: 'classify' }),
      ]),
    );
  });

  it('rejects optional AI outputs used by downstream params or bindings', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '위험도 분류',
          outputSchema: {
            type: 'object',
            properties: {
              riskLevel: { type: 'string' },
              summary: { type: 'string' },
            },
            required: ['riskLevel'],
          },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ops' },
          bindings: { text: { from: 'classify', output: 'summary' } },
          sideEffect: 'EXTERNAL',
        },
      ],
      inputs: [],
    };

    expect(validateWorkflowContracts(ir)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'invalid_workflow_reference',
          stepId: 'classify',
          message: expect.stringContaining('required'),
        }),
      ]),
    );
  });

  it('rejects a classified workflow that sends every notification linearly', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      steps: [
        {
          type: 'ai_decision',
          id: 'classify',
          goal: '위험도 분류',
          outputSchema: { type: 'object', properties: { riskLevel: { type: 'string' } } },
          investigation: false,
          maxReads: 1,
        },
        {
          type: 'action',
          id: 'critical',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#critical', text: '{{classify.riskLevel}}' },
          sideEffect: 'EXTERNAL',
        },
        {
          type: 'action',
          id: 'normal',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#normal', text: '{{classify.riskLevel}}' },
          sideEffect: 'EXTERNAL',
        },
      ],
      trigger: { type: 'manual' },
      inputs: [],
    };

    expect(validateWorkflowContracts(ir).some((issue) => issue.code === 'invalid_control_flow')).toBe(true);
  });

  it('rejects cyclic if branches before recursive contract validation', () => {
    const ir: WorkflowIR = {
      ...folderToDocument,
      trigger: { type: 'manual' },
      steps: [
        {
          type: 'if',
          id: 'root',
          condition: 'true',
          thenStepIds: ['branch_a'],
          elseStepIds: [],
        },
        {
          type: 'if',
          id: 'branch_a',
          condition: 'true',
          thenStepIds: ['notify'],
          elseStepIds: ['branch_b'],
        },
        {
          type: 'if',
          id: 'branch_b',
          condition: 'false',
          thenStepIds: ['notify'],
          elseStepIds: ['branch_a'],
        },
        {
          type: 'action',
          id: 'notify',
          connector: 'document',
          action: 'pdf.generate',
          actionRef: 'document.pdf.generate',
          params: {},
          sideEffect: 'REVERSIBLE',
        },
      ],
    };

    expect(validateWorkflowContracts(ir)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'invalid_control_flow', stepId: 'branch_a' }),
      ]),
    );
  });

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
