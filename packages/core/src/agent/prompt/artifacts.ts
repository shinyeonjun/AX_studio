import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_AGENTS_MD, EMBEDDED_AGENT_SOUL } from '../embedded.js';

function agentRootDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..');
}

export function loadAgentsConstitution(): string {
  const path = join(agentRootDir(), 'AGENTS.md');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  return EMBEDDED_AGENTS_MD.trim();
}

export function loadAgentsSoul(): string {
  const path = join(agentRootDir(), 'soul.md');
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  return EMBEDDED_AGENT_SOUL.trim();
}
