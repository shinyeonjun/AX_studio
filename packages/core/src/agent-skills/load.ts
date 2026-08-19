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

export function setAgentSkillsDir(dir: string | undefined) {
  skillsDirOverride = dir;
}

function candidateRoots(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const cwd = process.cwd();
  return [
    skillsDirOverride,
    process.env.AX_SKILLS_DIR,
    join(cwd, 'skills'),
    join(cwd, 'packages/core/skills'),
    join(cwd, '../../packages/core/skills'),
    join(here, '../../skills'),
    join(here, '../../../skills'),
  ].filter((path): path is string => Boolean(path));
}

export function parseSkillMarkdown(raw: string): Pick<AgentSkillFile, 'name' | 'description' | 'body'> {
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
  for (const root of candidateRoots()) {
    const path = join(root, id, 'SKILL.md');
    if (existsSync(path)) return readFileSync(path, 'utf8');
  }
  return undefined;
}

export function loadAgentSkill(id: string): AgentSkillFile {
  const raw = readSkillFromDisk(id) ?? EMBEDDED_AGENT_SKILLS[id];
  if (!raw) throw new Error(`Agent skill not found: ${id}`);
  const parsed = parseSkillMarkdown(raw);
  return { id, raw, ...parsed };
}
