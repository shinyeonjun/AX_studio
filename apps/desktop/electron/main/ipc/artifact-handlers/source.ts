import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

function isWithinRoot(rootDir: string, filePath: string): boolean {
  const relativePath = relative(resolve(rootDir), resolve(filePath));
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

export async function resolveGeneratedArtifactSourcePath(
  rootDir: string,
  storedPath: string,
  expectedSize: number,
  expectedSha256: string,
): Promise<string | undefined> {
  try {
    const [realRoot, realFile] = await Promise.all([realpath(rootDir), realpath(storedPath)]);
    if (!isWithinRoot(realRoot, realFile)) return undefined;
    const fileStat = await stat(realFile);
    if (!fileStat.isFile() || fileStat.size !== expectedSize) return undefined;
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(realFile)) hash.update(chunk);
    if (hash.digest('hex') !== expectedSha256) return undefined;
    return realFile;
  } catch {
    return undefined;
  }
}
