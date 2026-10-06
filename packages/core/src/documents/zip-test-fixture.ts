import { deflateRawSync } from 'node:zlib';

/** Build a single-entry ZIP. `declaredSize` lets a test forge the central directory. */
export function buildZip(content: Buffer, options: { declaredSize?: number; method?: number } = {}): Buffer {
  const method = options.method ?? 8;
  const payload = method === 8 ? deflateRawSync(content) : content;
  const declared = options.declaredSize ?? content.length;
  const name = Buffer.from('a.xml');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(method, 8);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(declared, 22);
  local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(method, 10);
  central.writeUInt32LE(payload.length, 20);
  central.writeUInt32LE(declared, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);
  const centralOffset = local.length + name.length + payload.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, payload, central, name, end]);
}
