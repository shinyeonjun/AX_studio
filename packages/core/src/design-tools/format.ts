import { listDesignTools } from './registry.js';

export function formatDesignToolsForPrompt(): string {
  return listDesignTools()
    .map((tool) => `- ${tool.id}${tool.args} — ${tool.description}`)
    .join('\n');
}
