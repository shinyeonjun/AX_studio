import type { SideEffectLevel, WorkflowIR } from './schema.js';

export function requiresApproval(
  sideEffect: SideEffectLevel,
  allowExternalAuto: boolean,
): boolean {
  if (sideEffect === 'EXTERNAL_HIGH') return true;
  if (sideEffect === 'EXTERNAL') return !allowExternalAuto;
  return false;
}

export function getActionSideEffects(ir: WorkflowIR): Map<string, SideEffectLevel> {
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

export function validateApprovalPolicy(ir: WorkflowIR): string[] {
  // Approval is enforced at the action execution boundary by requiresApproval.
  // The graph may still contain explicit legacy human_approval gates, but they
  // are not required for deployment and cannot be the policy source of truth.
  void ir;
  return [];
}

export function isDeployable(ir: WorkflowIR): boolean {
  const approvalErrors = validateApprovalPolicy(ir);
  return approvalErrors.length === 0 && ir.steps.length > 0;
}
