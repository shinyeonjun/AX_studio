import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Prepare an isolated AX data root for product QA.
 * Optionally seeds config (not credentials/db) from a source tree.
 */
export function prepareProductQaDataRoot(
  targetRoot: string,
  options: { sourceRoot?: string } = {},
): void {
  mkdirSync(targetRoot, { recursive: true });

  const sourceRoot = options.sourceRoot?.trim();
  if (!sourceRoot || !existsSync(sourceRoot)) return;

  const configSrc = join(sourceRoot, 'config');
  const configDst = join(targetRoot, 'config');
  if (existsSync(configSrc)) {
    mkdirSync(configDst, { recursive: true });
    cpSync(configSrc, configDst, { recursive: true, force: true });
  }
}
