import type { SkillIR } from '../skill/schema.js';

export function summarizeSkill(ir: Partial<SkillIR>): string {
  const lines = [
    `업무: ${ir.name}`,
    `목적: ${ir.goal}`,
    `실행: ${ir.trigger?.type ?? '수동'}`,
    `단계: ${ir.steps?.length ?? 0}개`,
    ir.success ? `완료 조건: ${ir.success}` : '',
  ];
  return lines.filter(Boolean).join('\n');
}
