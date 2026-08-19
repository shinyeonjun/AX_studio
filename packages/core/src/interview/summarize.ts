import type { SkillIR } from '../skill/schema.js';
import { renderChatSummary } from './chat-summary.js';

export function summarizeSkill(ir: Partial<SkillIR>): string {
  return renderChatSummary(ir);
}
