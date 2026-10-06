import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDED_AGENT_SKILLS } from './embedded.js';

export interface AgentSkillFile {
  id: string;
  name: string;
  description: string;
  body: string;
  raw: string;
}

let skillsDirOverride: string | undefined;
const skillCache = new Map<string, AgentSkillFile>();

export function setAgentSkillsDir(dir: string | undefined) {
  skillsDirOverride = dir;
  skillCache.clear();
}

/** Opt-in for local prompt iteration; never set in packaged builds. */
export const AGENT_SKILL_DEV_OVERRIDES_ENV = 'AX_AGENT_SKILL_DEV_OVERRIDES';

/**
 * Embedded skills are authoritative. Disk is consulted only for an explicit host override or
 * when the dev opt-in is set, so a packaged app never reads SKILL.md from cwd or env paths.
 */
function candidateSkillRoots(): string[] {
  const devRoots = process.env[AGENT_SKILL_DEV_OVERRIDES_ENV] === '1'
    ? [
        process.env.AX_SKILLS_DIR,
        join(dirname(fileURLToPath(import.meta.url)), 'skills'),
        join(process.cwd(), 'packages/core/src/intelligence/agent/skills'),
      ]
    : [];
  return [skillsDirOverride, ...devRoots].filter((path): path is string => Boolean(path));
}

function parseSkillMarkdown(raw: string): Pick<AgentSkillFile, 'name' | 'description' | 'body'> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { name: '', description: '', body: raw.trim() };
  const frontmatter = match[1];
  const body = match[2].trim();
  const name = frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? '';
  const description = frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
  return { name, description, body };
}

export function renderSkillTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_all, key: string) => vars[key] ?? '');
}

function readSkillFromDisk(id: string): string | undefined {
  for (const root of candidateSkillRoots()) {
    const path = join(root, id, 'SKILL.md');
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  return undefined;
}

export function loadAgentSkill(id: string): AgentSkillFile {
  const cached = skillCache.get(id);
  if (cached) return cached;
  const raw = readSkillFromDisk(id) ?? EMBEDDED_AGENT_SKILLS[id];
  if (!raw) throw new Error(`Agent skill not found: ${id}`);
  const parsed = parseSkillMarkdown(raw);
  const skill = { id, raw, ...parsed };
  skillCache.set(id, skill);
  return skill;
}
