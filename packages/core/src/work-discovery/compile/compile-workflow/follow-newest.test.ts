import { describe, expect, it } from 'vitest';
import { readStepForSource } from './sources.js';

describe('reading the source of a learned report', () => {
  it('follows the newest export in a connected folder', () => {
    const step = readStepForSource({ id: 'sheet:exports/주문내역_2026-08.xlsx', connector: 'local_sheet',
      metadata: { folderId: 'folder-1', path: 'exports/주문내역_2026-08.xlsx' } } as never);
    expect(step).toMatchObject({ connector: 'local_sheet', action: 'read', params: { folderId: 'folder-1', followNewest: true } });
  });

  it('reads an uploaded example as given (there is no folder to find next month in)', () => {
    const step = readStepForSource({ id: 'input:art_1', connector: 'input_artifact', metadata: { storedPath: 'D:/store/a.xlsx' } } as never);
    expect(step && 'params' in step ? step.params : {}).not.toHaveProperty('followNewest');
  });
});
