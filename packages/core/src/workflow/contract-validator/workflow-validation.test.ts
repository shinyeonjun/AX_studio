import { describe, expect, it } from 'vitest';
import { validateWorkflowContracts } from '../contract-validator.js';
import type { WorkflowIR } from '../schema.js';
import { folderToDocument } from './fixtures.js';
describe('validateWorkflowContracts', () => {
  it('accepts local folder trigger feeding document ingest', () => {
    expect(validateWorkflowContracts(folderToDocument)).toEqual([]);
  });
  it('accepts manual workflows with concrete ingest path', () => {
    const ir: WorkflowIR = { ...folderToDocument, trigger: { type: 'manual' }, steps: [{ type: 'action', id: 'ingest', connector: 'document', action: 'ingest', params: { path: 'C:\\fixed\\doc.pdf' }, sideEffect: 'NONE' }], inputs: [] };
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
    const issues = validateWorkflowContracts({ ...folderToDocument, trigger: { type: 'schedule', schedule: 'every Friday', timezone: 'Asia/Seoul' } });
    expect(issues.some((issue) => issue.code === 'invalid_workflow_schema')).toBe(true);
  });
  it('rejects an invalid schedule timezone instead of saving a never-running workflow', () => {
    const issues = validateWorkflowContracts({ ...folderToDocument, trigger: { type: 'schedule', schedule: '0 9 * * *', timezone: 'Mars/Olympus' } });
    expect(issues).toContainEqual(expect.objectContaining({ code: 'invalid_workflow_schema', message: 'schedule timezone이 올바르지 않습니다: Mars/Olympus' }));
  });
});
