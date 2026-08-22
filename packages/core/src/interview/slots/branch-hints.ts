import type { ConditionExpr } from '../../runtime/condition-expr.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';
import { nodeRoleHint } from './ids.js';

function extractEqLiteral(condition: ConditionExpr | undefined): string | undefined {
  if (!condition || condition.op !== 'eq') return undefined;
  if ('lit' in condition.right) {
    const lit = condition.right.lit;
    return lit == null ? undefined : String(lit);
  }
  return undefined;
}

function roleHintForLiteral(literal: string | undefined): string | undefined {
  if (!literal?.trim()) return undefined;
  return nodeRoleHint(`branch_${literal.trim()}`);
}

function actionIdsInBranch(stepIds: string[], byId: Map<string, Step>): string[] {
  const out: string[] = [];
  for (const id of stepIds) {
    const step = byId.get(id);
    if (step?.type === 'action') out.push(id);
  }
  return out;
}

function collectEnumLiterals(ir: Partial<WorkflowIR>): string[] {
  for (const step of ir.steps ?? []) {
    if (step.type !== 'ai_decision') continue;
    const properties = step.outputSchema?.properties;
    if (!properties || typeof properties !== 'object' || Array.isArray(properties)) continue;
    for (const definition of Object.values(properties as Record<string, unknown>)) {
      if (!definition || typeof definition !== 'object' || Array.isArray(definition)) continue;
      const enumValues = (definition as Record<string, unknown>).enum;
      if (Array.isArray(enumValues) && enumValues.length >= 2) {
        return enumValues.map((value) => String(value));
      }
    }
  }
  return [];
}

/** Map action node ids to user-facing branch labels inferred from if wiring. */
export function branchHintsFromWorkflow(ir: Partial<WorkflowIR>): Map<string, string> {
  const hints = new Map<string, string>();
  const steps = ir.steps ?? [];
  const byId = new Map(steps.map((step) => [step.id, step]));
  const usedLiterals: string[] = [];

  function assign(stepIds: string[], literal: string | undefined) {
    const hint = roleHintForLiteral(literal);
    if (!hint) return;
    for (const id of actionIdsInBranch(stepIds, byId)) {
      if (!hints.has(id)) hints.set(id, hint);
    }
  }

  function walkIf(ifId: string): void {
    const step = byId.get(ifId);
    if (!step || step.type !== 'if') return;

    const literal = extractEqLiteral(step.condition);
    if (literal) usedLiterals.push(literal.toLowerCase());
    assign(step.thenStepIds, literal);

    const elseIds = step.elseStepIds ?? [];
    if (elseIds.length === 1 && byId.get(elseIds[0]!)?.type === 'if') {
      walkIf(elseIds[0]!);
      return;
    }

    const enumLiterals = collectEnumLiterals(ir);
    const remaining = enumLiterals.filter((value) => !usedLiterals.includes(value.toLowerCase()));
    assign(elseIds, remaining[0] ?? 'normal');
  }

  for (const step of steps) {
    if (step.type === 'if') walkIf(step.id);
  }

  for (const step of steps) {
    if (step.type !== 'action' || hints.has(step.id)) continue;
    const fromId = nodeRoleHint(step.id);
    if (fromId) hints.set(step.id, fromId);
  }

  return hints;
}
