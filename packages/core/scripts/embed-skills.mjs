import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const harnessDir = join(root, 'src/agent');
const skillsDir = join(harnessDir, 'skills');
const agentsMdPath = join(harnessDir, 'AGENTS.md');

function findSkillFiles(directory, prefix = '') {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = join(directory, entry.name);
    const id = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...findSkillFiles(entryPath, id));
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      files.push({ id: prefix, path: entryPath });
    }
  }
  return files;
}

const skillFiles = findSkillFiles(skillsDir).sort((left, right) => left.id.localeCompare(right.id));

const skillEntries = skillFiles.map(({ id, path }) => {
  const markdown = readFileSync(path, 'utf8');
  return `  ${JSON.stringify(id)}: ${JSON.stringify(markdown)}`;
});

const agentsMd = readFileSync(agentsMdPath, 'utf8');

const out = `export const EMBEDDED_AGENT_SKILLS: Record<string, string> = {\n${skillEntries.join(',\n')}\n};\n\nexport const EMBEDDED_AGENTS_MD = ${JSON.stringify(agentsMd)};\n`;

writeFileSync(join(harnessDir, 'embedded.ts'), out);
