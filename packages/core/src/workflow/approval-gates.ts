import type { SideEffectLevel, WorkflowIR } from './schema.js';
import { requiresApproval } from './approval.js';
import { actionRefFor, resolveActionDefinition } from './action-definition.js';
import { resolveEffectiveSideEffect } from './side-effect-resolve.js';

export interface ApprovalGateEntry {
  stepId: string;
  actionRef: string;
  sideEffect: SideEffectLevel;
  requiresApproval: boolean;
}

export interface ApprovalGateSummary {
  allowExternalAuto: boolean;
  gates: ApprovalGateEntry[];
  highRiskCount: number;
  externalCount: number;
}

export function summarizeApprovalGates(ir: Partial<WorkflowIR>): ApprovalGateSummary {
  const allowExternalAuto = ir.allowExternalAuto ?? false;
  const gates: ApprovalGateEntry[] = [];

  for (const step of ir.steps ?? []) {
    if (step.type !== 'action') continue;
    const actionRef = step.actionRef ?? actionRefFor(step.connector, step.action);
    const definition = resolveActionDefinition(actionRef);
    if (!definition) continue;

    const override = ir.sideEffects?.[step.id];
    const sideEffect = resolveEffectiveSideEffect(
      definition,
      step.params,
      override ?? step.sideEffect,
    );
    const needsApproval = requiresApproval(sideEffect, allowExternalAuto);
    if (sideEffect === 'EXTERNAL' || sideEffect === 'EXTERNAL_HIGH' || needsApproval) {
      gates.push({ stepId: step.id, actionRef, sideEffect, requiresApproval: needsApproval });
    }
  }

  return {
    allowExternalAuto,
    gates,
    highRiskCount: gates.filter((gate) => gate.sideEffect === 'EXTERNAL_HIGH').length,
    externalCount: gates.filter((gate) => gate.sideEffect === 'EXTERNAL').length,
  };
}
