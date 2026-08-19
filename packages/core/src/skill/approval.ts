import type { SideEffectLevel, SkillIR } from './schema.js';

export function requiresApproval(
  sideEffect: SideEffectLevel,
  allowExternalAuto: boolean,
): boolean {
  if (sideEffect === 'EXTERNAL_HIGH') return true;
  if (sideEffect === 'EXTERNAL') return !allowExternalAuto;
  return false;
}

export function getActionSideEffects(ir: SkillIR): Map<string, SideEffectLevel> {
  const map = new Map<string, SideEffectLevel>();
  for (const step of ir.steps) {
    if (step.type === 'action') {
      map.set(step.id, step.sideEffect);
      if (ir.sideEffects?.[step.id]) {
        map.set(step.id, ir.sideEffects[step.id]);
      }
    }
  }
  return map;
}

export function validateApprovalPolicy(ir: SkillIR): string[] {
  const errors: string[] = [];
  const actionEffects = getActionSideEffects(ir);

  for (const [actionId, level] of actionEffects) {
    if (level === 'EXTERNAL_HIGH') {
      const hasApproval = ir.steps.some(
        (s) =>
          s.type === 'human_approval' &&
          s.forActionIds.includes(actionId),
      );
      if (!hasApproval) {
        errors.push(`Action ${actionId} (${level}) requires human_approval step`);
      }
    }
  }

  return errors;
}

export function isDeployable(ir: SkillIR): boolean {
  const approvalErrors = validateApprovalPolicy(ir);
  return approvalErrors.length === 0 && ir.steps.length > 0;
}
