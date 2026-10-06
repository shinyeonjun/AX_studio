import { inflateRawSync } from 'node:zlib';

const ZIP_LOCAL_FILE_SIGNATURE = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_STORED = 0;
const ZIP_DEFLATED = 8;

/**
 * Verify that every archive entry really inflates to the size its central
 * directory declares, without ever inflating more than that. Callers already
 * cap the *declared* sizes; this makes the cap binding before PizZip or SheetJS
 * expand the archive in memory (a forged header can no longer hide a bomb).
 *
 * Throws `${prefix}_invalid_zip`, `${prefix}_zip_unsupported_compression` or
 * `${prefix}_zip_inflated_size_mismatch`.
 */
export function assertZipEntriesInflateToDeclaredSize(data: Uint8Array, prefix: string): void {
  const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const invalid = () => new Error(`${prefix}_invalid_zip`);
  if (bytes.length < 22) throw invalid();
  let endOffset = -1;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65_557); offset -= 1) {
    if (bytes.readUInt32LE(offset) === ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw invalid();
  const entryCount = bytes.readUInt16LE(endOffset + 10);
  let cursor = bytes.readUInt32LE(endOffset + 16);

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > bytes.length || bytes.readUInt32LE(cursor) !== ZIP_CENTRAL_DIRECTORY_SIGNATURE) throw invalid();
    const method = bytes.readUInt16LE(cursor + 10);
    const compressedSize = bytes.readUInt32LE(cursor + 20);
    const declaredSize = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const extraLength = bytes.readUInt16LE(cursor + 30);
    const commentLength = bytes.readUInt16LE(cursor + 32);
    const localOffset = bytes.readUInt32LE(cursor + 42);
    cursor += 46 + nameLength + extraLength + commentLength;

    if (localOffset + 30 > bytes.length || bytes.readUInt32LE(localOffset) !== ZIP_LOCAL_FILE_SIGNATURE) throw invalid();
    const dataStart = localOffset + 30 + bytes.readUInt16LE(localOffset + 26) + bytes.readUInt16LE(localOffset + 28);
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.length) throw invalid();

    let actualSize: number;
    if (method === ZIP_STORED) {
      actualSize = compressedSize;
    } else if (method === ZIP_DEFLATED) {
      try {
        // One byte of headroom detects an entry that inflates beyond its declaration.
        actualSize = inflateRawSync(bytes.subarray(dataStart, dataEnd), { maxOutputLength: declaredSize + 1 }).length;
      } catch {
        throw new Error(`${prefix}_zip_inflated_size_mismatch`);
      }
    } else {
      throw new Error(`${prefix}_zip_unsupported_compression`);
    }
    if (actualSize !== declaredSize) throw new Error(`${prefix}_zip_inflated_size_mismatch`);
  }
}
