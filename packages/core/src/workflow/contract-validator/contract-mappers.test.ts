import { describe, expect, it } from 'vitest';
import { documentIngestParamsFromFileRef, fileRefFromTriggerPayload, resolveDocumentIngestParams } from '../../contracts/mappers.js';
describe('contract mappers', () => {
  it('maps trigger payload to FileRef and ingest params', () => {
    const file = fileRefFromTriggerPayload({ folderId: 'folder-1', filePath: 'D:\\docs\\sample.pdf', fileName: 'sample.pdf', extension: '.pdf' });
    expect(file?.path).toBe('D:\\docs\\sample.pdf');
    expect(documentIngestParamsFromFileRef(file!)).toEqual({ file: expect.objectContaining({ path: 'D:\\docs\\sample.pdf' }) });
  });
  it('resolves document ingest input from execution variables', () => {
    const params = resolveDocumentIngestParams({ path: '{{filePath}}' }, { filePath: 'C:\\inbox\\doc.pdf', fileName: 'doc.pdf' });
    expect(params.file).toEqual(expect.objectContaining({ path: 'C:\\inbox\\doc.pdf' }));
    expect(params.path).toBeUndefined();
  });
});
