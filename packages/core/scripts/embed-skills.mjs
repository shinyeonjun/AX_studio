import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const skillsDir = join(root, 'skills');
const ids = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const entries = ids.map((id) => {
  const markdown = readFileSync(join(skillsDir, id, 'SKILL.md'), 'utf8');
  return `  ${JSON.stringify(id)}: ${JSON.stringify(markdown)}`;
});

const out = `export const EMBEDDED_AGENT_SKILLS: Record<string, string> = {\n${entries.join(',\n')}\n};\n`;
writeFileSync(join(root, 'src/agent-skills/embedded.ts'), out);
