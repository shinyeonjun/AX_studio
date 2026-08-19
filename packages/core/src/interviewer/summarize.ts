import type { SkillIR } from '../skill/schema.js';
import { renderWorkSkillMarkdown } from './work-skill-document.js';

export function summarizeSkill(ir: Partial<SkillIR>): string {
  return ir.document?.trim() || renderWorkSkillMarkdown(ir);
}
