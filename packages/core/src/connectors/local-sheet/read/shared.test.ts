import { describe, expect, it } from 'vitest';
import { assertXlsxArchiveSafety } from './shared.js';

function makeCentralDirectoryArchive(options: {
  compressedBytes: number;
  uncompressedBytes: number;
  flags?: number;
}): Uint8Array {
  const centralDirectorySize = 47;
  const endOffset = 47;
  const bytes = Buffer.alloc(endOffset + 22);
  bytes.writeUInt32LE(0x02014b50, 0);
  bytes.writeUInt16LE(options.flags ?? 0, 8);
  bytes.writeUInt32LE(options.compressedBytes, 20);
  bytes.writeUInt32LE(options.uncompressedBytes, 24);
  bytes.writeUInt16LE(1, 28);
  bytes.write('x', 46);
  bytes.writeUInt32LE(0x06054b50, endOffset);
  bytes.writeUInt16LE(1, endOffset + 8);
  bytes.writeUInt16LE(1, endOffset + 10);
  bytes.writeUInt32LE(centralDirectorySize, endOffset + 12);
  bytes.writeUInt32LE(0, endOffset + 16);
  return bytes;
}

describe('assertXlsxArchiveSafety', () => {
  it('accepts a small ordinary ZIP central directory', () => {
    expect(() => assertXlsxArchiveSafety(makeCentralDirectoryArchive({
      compressedBytes: 100,
      uncompressedBytes: 1_000,
    }))).not.toThrow();
  });

  it('rejects an archive with an excessive compression ratio', () => {
    expect(() => assertXlsxArchiveSafety(makeCentralDirectoryArchive({
      compressedBytes: 1,
      uncompressedBytes: 101,
    }))).toThrow('xlsx_archive_compression_ratio_too_high');
  });

  it('rejects encrypted entries before parsing', () => {
    expect(() => assertXlsxArchiveSafety(makeCentralDirectoryArchive({
      compressedBytes: 100,
      uncompressedBytes: 1_000,
      flags: 1,
    }))).toThrow('xlsx_encrypted_entry_not_supported');
  });
});
