import { describe, expect, it } from 'vitest';
import { assertZipEntriesInflateToDeclaredSize } from './zip-guard.js';
import { buildZip } from './zip-test-fixture.js';

describe('assertZipEntriesInflateToDeclaredSize', () => {
  const content = Buffer.from('<x>'.repeat(10_000));

  it('accepts deflated and stored entries whose sizes are truthful', () => {
    expect(() => assertZipEntriesInflateToDeclaredSize(buildZip(content), 'test')).not.toThrow();
    expect(() => assertZipEntriesInflateToDeclaredSize(buildZip(content, { method: 0 }), 'test')).not.toThrow();
  });

  it('rejects an entry that inflates beyond its declared size without inflating it fully', () => {
    expect(() => assertZipEntriesInflateToDeclaredSize(buildZip(content, { declaredSize: 100 }), 'test'))
      .toThrow('test_zip_inflated_size_mismatch');
  });

  it('rejects an entry that inflates to less than declared', () => {
    expect(() => assertZipEntriesInflateToDeclaredSize(buildZip(content, { declaredSize: content.length + 1 }), 'test'))
      .toThrow('test_zip_inflated_size_mismatch');
  });

  it('rejects unknown compression methods and missing local headers', () => {
    expect(() => assertZipEntriesInflateToDeclaredSize(buildZip(content, { method: 12 }), 'test'))
      .toThrow('test_zip_unsupported_compression');
    expect(() => assertZipEntriesInflateToDeclaredSize(Buffer.alloc(30), 'test')).toThrow('test_invalid_zip');
  });
});
