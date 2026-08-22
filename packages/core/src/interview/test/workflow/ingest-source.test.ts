import { describe, expect, it } from 'vitest';
import { validateWorkflowForPersistence } from '../../../workflow/contract-validator.js';
import {
  documentIngestPathSatisfied,
  isDocumentIngestSourceConfigured,
} from '../../../workflow/ingest-source.js';
import type { WorkflowIR } from '../../../workflow/schema.js';

describe('document ingest source configuration', () => {
  it('accepts file ref params without path', () => {
    expect(
      isDocumentIngestSourceConfigured({
        file: { path: 'D:\\inbox\\report.pdf', name: 'report.pdf', folderId: 'folder-1' },
      }),
    ).toBe(true);
  });

  it('accepts trigger binding without path', () => {
    const step = {
      type: 'action' as const,
      id: 'ingest_pdf',
      connector: 'document',
      action: 'ingest',
      params: {},
      bindings: { source: { from: 'trigger', output: 'file' } },
      sideEffect: 'NONE' as const,
    };
    expect(documentIngestPathSatisfied(step)).toBe(true);
  });
});

describe('validateWorkflowForPersistence document ingest', () => {
  const base: WorkflowIR = {
    id: 'wf',
    name: 'PDF 알림',
    goal: 'PDF 분류 알림',
    version: 1,
    trigger: { type: 'manual' },
    steps: [],
    success: '모든 알림 단계가 실행되면 완료',
    assumptions: [],
    inputs: ['filePath'],
    permissions: {},
    approval: [],
    allowExternalAuto: true,
    dataPolicy: {},
  };

  it('allows save when ingest uses file ref from connected folder list', () => {
    const ir: WorkflowIR = {
      ...base,
      steps: [
        {
          type: 'action',
          id: 'ingest_pdf',
          connector: 'document',
          action: 'ingest',
          params: {
            file: { path: 'D:\\inbox\\report.pdf', name: 'report.pdf', folderId: 'folder-1' },
          },
          sideEffect: 'NONE',
        },
      ],
    };

    expect(validateWorkflowForPersistence(ir)).toEqual([]);
  });
});
