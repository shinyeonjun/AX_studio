import { statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { FileRef } from '../../../contracts/artifacts/file-ref.js';
import { fileRefFromLocalScan } from '../../../contracts/artifacts/file-ref.js';
import { MAX_WORKBOOK_BYTES } from '../profile.js';

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_MIN_BYTES = 22;
const ZIP_END_OF_CENTRAL_DIRECTORY_MAX_COMMENT_BYTES = 0xffff;
const ZIP_CENTRAL_DIRECTORY_ENTRY_BYTES = 46;
const MAX_WORKBOOK_ARCHIVE_ENTRIES = 10_000;
const MAX_WORKBOOK_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
const MAX_WORKBOOK_COMPRESSION_RATIO = 100;

export function assertWorkbookSize(path: string): void {
  assertWorkbookByteLength(statSync(path).size);
}

export function assertWorkbookByteLength(size: number): void {
  if (size > MAX_WORKBOOK_BYTES) {
    throw new Error(`스프레드시트 파일이 너무 큽니다. ${Math.round(MAX_WORKBOOK_BYTES / (1024 * 1024))}MB 이하만 읽을 수 있습니다.`);
  }
}

export function looksLikeZipArchive(data: Uint8Array): boolean {
  if (data.byteLength < 4) return false;
  const signature = Buffer.from(data.buffer, data.byteOffset, data.byteLength).readUInt32LE(0);
  return signature === ZIP_LOCAL_FILE_SIGNATURE;
}

/** Inspect ZIP metadata before SheetJS expands an untrusted XLSX archive in memory. */
export function assertXlsxArchiveSafety(data: Uint8Array): void {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  if (bytes.length < ZIP_END_OF_CENTRAL_DIRECTORY_MIN_BYTES) throw new Error('xlsx_invalid_zip');
  const searchStart = Math.max(
    0,
    bytes.length - ZIP_END_OF_CENTRAL_DIRECTORY_MIN_BYTES - ZIP_END_OF_CENTRAL_DIRECTORY_MAX_COMMENT_BYTES,
  );
  let endOffset = -1;
  for (let offset = bytes.length - ZIP_END_OF_CENTRAL_DIRECTORY_MIN_BYTES; offset >= searchStart; offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('xlsx_invalid_zip');

  const diskNumber = bytes.readUInt16LE(endOffset + 4);
  const centralDirectoryDisk = bytes.readUInt16LE(endOffset + 6);
  const entriesOnDisk = bytes.readUInt16LE(endOffset + 8);
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  const centralDirectorySize = bytes.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = bytes.readUInt32LE(endOffset + 16);
  if (
    diskNumber !== 0
    || centralDirectoryDisk !== 0
    || entriesOnDisk !== entryCount
    || entryCount === 0xffff
    || centralDirectorySize === 0xffffffff
    || centralDirectoryOffset === 0xffffffff
  ) {
    throw new Error('xlsx_zip64_or_multidisk_not_supported');
  }
  if (entryCount > MAX_WORKBOOK_ARCHIVE_ENTRIES) throw new Error('xlsx_too_many_archive_entries');

  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;
  if (
    centralDirectoryEnd < centralDirectoryOffset
    || centralDirectoryOffset > bytes.length
    || centralDirectoryEnd > endOffset
  ) {
    throw new Error('xlsx_invalid_zip_directory');
  }

  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + ZIP_CENTRAL_DIRECTORY_ENTRY_BYTES > centralDirectoryEnd) {
      throw new Error('xlsx_invalid_zip_directory');
    }
    if (bytes.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error('xlsx_invalid_zip_directory');
    }

    const flags = bytes.readUInt16LE(cursor + 8);
    const compressedBytes = bytes.readUInt32LE(cursor + 20);
    const uncompressedBytes = bytes.readUInt32LE(cursor + 24);
    const fileNameBytes = bytes.readUInt16LE(cursor + 28);
    const extraBytes = bytes.readUInt16LE(cursor + 30);
    const commentBytes = bytes.readUInt16LE(cursor + 32);
    const entryBytes = ZIP_CENTRAL_DIRECTORY_ENTRY_BYTES + fileNameBytes + extraBytes + commentBytes;
    const nextCursor = cursor + entryBytes;
    if (nextCursor < cursor || nextCursor > centralDirectoryEnd) throw new Error('xlsx_invalid_zip_directory');
    if ((flags & 0x0001) !== 0) throw new Error('xlsx_encrypted_entry_not_supported');
    if (uncompressedBytes > MAX_WORKBOOK_UNCOMPRESSED_BYTES - totalUncompressedBytes) {
      throw new Error('xlsx_archive_uncompressed_too_large');
    }
    totalUncompressedBytes += uncompressedBytes;
    if (
      compressedBytes === 0
      ? uncompressedBytes > 0
      : uncompressedBytes / compressedBytes > MAX_WORKBOOK_COMPRESSION_RATIO
    ) {
      throw new Error('xlsx_archive_compression_ratio_too_high');
    }
    cursor = nextCursor;
  }
  if (cursor !== centralDirectoryEnd) throw new Error('xlsx_invalid_zip_directory');

  const locatorOffset = endOffset - 20;
  if (locatorOffset >= 0 && bytes.readUInt32LE(locatorOffset) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE) {
    throw new Error('xlsx_zip64_or_multidisk_not_supported');
  }
  const zip64RecordOffset = endOffset - 56;
  if (zip64RecordOffset >= 0 && bytes.readUInt32LE(zip64RecordOffset) === ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    throw new Error('xlsx_zip64_or_multidisk_not_supported');
  }
}

export function fileRefForPath(path: string): FileRef {
  const name = basename(path);
  return fileRefFromLocalScan({
    filePath: path,
    fileName: name,
    extension: extname(name),
  });
}

export function sheetVisibility(hidden: number | undefined): 'visible' | 'hidden' | 'veryHidden' {
  if (hidden === 1) return 'hidden';
  if (hidden === 2) return 'veryHidden';
  return 'visible';
}
