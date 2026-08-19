import { describe, expect, it } from 'vitest';
import { contractTypesCompatible, canSatisfyInput } from '../contracts/compatibility.js';
import {
  documentIngestParamsFromFileRef,
  fileRefFromTriggerPayload,
  resolveDocumentIngestParams,
} from '../contracts/mappers.js';
import { validateWorkflowContracts } from './contract-validator.js';
import type { WorkflowIR } from './schema.js';

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
    expect(documentIngestParamsFromFileRef(file!)).toEqual({ path: 'D:\\docs\\sample.pdf' });
  });

  it('resolves document ingest path from execution variables', () => {
    const params = resolveDocumentIngestParams(
      { path: '{{filePath}}' },
      { filePath: 'C:\\inbox\\doc.pdf', fileName: 'doc.pdf' },
    );
    expect(params.path).toBe('C:\\inbox\\doc.pdf');
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
