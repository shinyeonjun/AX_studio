import { describe, expect, it } from 'vitest';
import { canSatisfyInput, contractTypesCompatible } from '../../contracts/compatibility.js';
describe('contract compatibility', () => {
  it('allows FileRef to satisfy DocumentIngestInput', () => {
    expect(contractTypesCompatible('FileRef', 'DocumentIngestInput')).toBe(true);
    expect(canSatisfyInput(['FileRef'], 'DocumentIngestInput')).toBe(true);
  });
  it('rejects unrelated contracts', () => {
    expect(contractTypesCompatible('SlackMessageRef', 'DocumentIngestInput')).toBe(false);
  });
});
