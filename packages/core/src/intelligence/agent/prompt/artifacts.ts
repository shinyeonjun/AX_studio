import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_AGENTS_MD, EMBEDDED_AGENT_SOUL } from '../embedded.js';
import { AGENT_SKILL_DEV_OVERRIDES_ENV } from '../skill-load.js';

let cachedConstitution: string | undefined;
let cachedSoul: string | undefined;

function agentRootDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

/**
 * Embedded copies are authoritative (same policy as skills). The file next to the module
 * is read only with the explicit dev opt-in, so a packaged or bundled runtime never picks
 * up a stray AGENTS.md/soul.md from disk.
 */
function readArtifact(fileName: string, embedded: string): string {
  if (process.env[AGENT_SKILL_DEV_OVERRIDES_ENV] === '1') {
    const path = join(agentRootDir(), fileName);
    if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  }
  return embedded.trim();
}

export function loadAgentsConstitution(): string {
  cachedConstitution ??= readArtifact('AGENTS.md', EMBEDDED_AGENTS_MD);
  return cachedConstitution;
}

export function loadAgentsSoul(): string {
  cachedSoul ??= readArtifact('soul.md', EMBEDDED_AGENT_SOUL);
  return cachedSoul;
}
