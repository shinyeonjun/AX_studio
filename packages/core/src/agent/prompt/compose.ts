import { loadAgentsConstitution, loadAgentsSoul } from './artifacts.js';

export function composeAgentSystemPrompt(roleSystem: string): string {
  const constitution = loadAgentsConstitution();
  const soul = loadAgentsSoul();
  return `${constitution}\n\n--- Agent voice (soul.md) ---\n${soul}\n--- /Agent voice ---\n\n---\n\n${roleSystem}`;
}
