import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const harnessDir = join(root, 'src/agents-harness');
const skillsDir = join(harnessDir, 'skills');
const agentsMdPath = join(harnessDir, 'agents.md');

const ids = readdirSync(skillsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const skillEntries = ids.map((id) => {
  const markdown = readFileSync(join(skillsDir, id, 'SKILL.md'), 'utf8');
  return `  ${JSON.stringify(id)}: ${JSON.stringify(markdown)}`;
});

const agentsMd = readFileSync(agentsMdPath, 'utf8');

const out = `export const EMBEDDED_AGENT_SKILLS: Record<string, string> = {\n${skillEntries.join(',\n')}\n};\n\nexport const EMBEDDED_AGENTS_MD = ${JSON.stringify(agentsMd)};\n`;

writeFileSync(join(harnessDir, 'embedded.ts'), out);
