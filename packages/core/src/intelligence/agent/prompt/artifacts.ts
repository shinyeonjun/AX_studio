import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_AGENTS_MD, EMBEDDED_AGENT_SOUL } from '../embedded.js';

let cachedConstitution: string | undefined;
let cachedSoul: string | undefined;

function agentRootDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

export function loadAgentsConstitution(): string {
  if (cachedConstitution !== undefined) return cachedConstitution;
  const path = join(agentRootDir(), 'AGENTS.md');
  cachedConstitution = (existsSync(path) ? readFileSync(path, 'utf8') : EMBEDDED_AGENTS_MD).trim();
  return cachedConstitution;
}

export function loadAgentsSoul(): string {
  if (cachedSoul !== undefined) return cachedSoul;
  const path = join(agentRootDir(), 'soul.md');
  cachedSoul = (existsSync(path) ? readFileSync(path, 'utf8') : EMBEDDED_AGENT_SOUL).trim();
  return cachedSoul;
}
