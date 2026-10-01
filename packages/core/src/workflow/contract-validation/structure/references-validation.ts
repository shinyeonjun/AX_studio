import type { Step, WorkflowIR } from '../../schema.js';
import { classifyDecisionOutput } from '../../../contracts/decision.js';
import { resolveCapability } from '../../../catalog/capability-graph.js';
import { decisionOutputDefinition, isProseActionInput, isProseOnlyDecision } from '../../ai-output-contract.js';
import type { ContractValidationIssue } from '../types.js';
import { conditionReferencePaths, outputFieldExists, outputFieldIsRequired, referencePaths } from './references.js';

interface ReferenceUse {
  reference: string;
  target?: Step;
  port?: string;
  branch?: boolean;
  structural?: boolean;
}

function stepReferences(step: Step): ReferenceUse[] {
  const structural = (value: unknown): ReferenceUse[] => referencePaths(value)
    .map((reference) => ({ reference, target: step, structural: true }));
  switch (step.type) {
    case 'if': return [
      ...conditionReferencePaths(step.condition).map((reference) => ({ reference, target: step, branch: true })),
      ...structural([step.thenStepIds, step.elseStepIds]),
    ];
    case 'human_approval': return structural([step.reason, step.forActionIds]);
    case 'action': return [
      ...structural([step.connector, step.action, step.actionRef, step.sideEffect]),
      ...Object.entries(step.params).flatMap(([port, value]) => referencePaths(value)
        .map((reference) => ({ reference, target: step, port }))),
      ...Object.entries(step.bindings ?? {}).map(([port, binding]) => ({
        reference: `${binding.from}.${binding.output}`, target: step, port,
      })),
    ];
    case 'ai_decision': return [
      ...structural([step.goal, step.memo]),
      ...Object.entries(step.bindings ?? {}).map(([port, binding]) => ({
        reference: `${binding.from}.${binding.output}`, target: step, port,
      })),
    ];
  }
}

function referenceSource(reference: string, byId: Map<string, Step>, aliases: Record<string, string>): Step | undefined {
  const [root, field] = reference.split('.');
  return byId.get(root!) ?? byId.get(aliases[root === 'trigger' ? field! : root!] ?? '');
}

function isPresentationReference(reference: string, byId: Map<string, Step>, derived: Set<string>, aliases: Record<string, string> = {}): boolean {
  const [, field] = reference.split('.');
  const source = referenceSource(reference, byId, aliases);
  if (source?.type === 'ai_decision') {
    const kind = classifyDecisionOutput(decisionOutputDefinition(source, field ?? '')).kind;
    return kind === 'model' || kind === 'unsupported';
  }
  return Boolean(source && derived.has(source.id));
}

function presentationAliases(ir: WorkflowIR, derived: Set<string>, runtimeSources: Record<string, string>): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const step of ir.steps) {
    if (step.type !== 'action' || !derived.has(step.id) || step.connector !== 'document') continue;
    if (step.action === 'html.render') aliases.documentHtml = step.id;
    if (step.action === 'pdf.generate') {
      for (const key of ['reportPdfArtifact', 'reportPdfArtifactId', 'reportPdfSize', 'generatedPdfName']) aliases[key] = step.id;
    }
  }
  return { ...aliases, ...runtimeSources };
}

/** Conservatively keep outputs of content-consuming actions in the content flow. */
export function presentationDerivedSteps(ir: WorkflowIR, runtimeSources: Record<string, string> = {}): Set<string> {
  const byId = new Map(ir.steps.map((step) => [step.id, step]));
  const derived = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const aliases = presentationAliases(ir, derived, runtimeSources);
    for (const step of ir.steps) {
      if (step.type !== 'action' || derived.has(step.id)) continue;
      const implicitRenderedHtml = step.connector === 'document' && step.action === 'pdf.generate'
        && step.params.html == null && Boolean(aliases.documentHtml);
      if (implicitRenderedHtml || stepReferences(step).some(({ reference }) => isPresentationReference(reference, byId, derived, aliases))) {
        derived.add(step.id);
        changed = true;
      }
    }
  }
  return derived;
}

function canReceivePresentation(use: ReferenceUse, source: Step): boolean {
  const { target, port } = use;
  if (!target || !port || use.structural || use.branch) return false;
  if (target.type === 'ai_decision') {
    return isProseOnlyDecision(target) && target.inputContracts?.[port] === 'TextArtifact';
  }
  if (target.type !== 'action') return false;
  if (isProseActionInput(target, port)) return true;
  // Only host-rendered HTML may enter the PDF renderer. LLM prose cannot be
  // supplied as a template or raw HTML, and the PDF result remains derived.
  return source.type === 'action' && source.connector === 'document' && source.action === 'html.render'
    && [`${source.id}.html`, 'documentHtml', 'trigger.documentHtml'].includes(use.reference)
    && target.connector === 'document' && target.action === 'pdf.generate' && port === 'html';
}

function canReceiveDecision(use: ReferenceUse, source: Extract<Step, { type: 'ai_decision' }>, field: string): boolean {
  const route = classifyDecisionOutput(decisionOutputDefinition(source, field));
  const bounded = route.kind === 'boolean' || route.kind === 'choice' || route.kind === 'constant';
  if (use.structural || !bounded) return false;
  if (use.branch || use.target?.type === 'ai_decision') return true;
  if (use.target?.type !== 'action' || !use.port) return false;
  const capability = resolveCapability(use.target.connector, use.target.action);
  const inputType = capability?.params.find((parameter) => parameter.name === use.port)?.inputType;
  const stringChoice = (route.kind === 'constant' && typeof route.value === 'string')
    || (route.kind === 'choice' && route.options.every((option) => typeof option === 'string'));
  if (inputType || capability?.io?.inputs[use.port] === 'TextArtifact' || isProseActionInput(use.target, use.port)) {
    return stringChoice;
  }
  return true;
}

export function validateWorkflowReferences(ir: WorkflowIR, byId: Map<string, Step>, runtimeSources: Record<string, string> = {}): ContractValidationIssue[] {
  const derived = presentationDerivedSteps(ir, runtimeSources);
  const aliases = presentationAliases(ir, derived, runtimeSources);
  const uses: ReferenceUse[] = [
    ...ir.steps.flatMap(stepReferences),
    ...referencePaths([ir.permissions, ir.approval, ir.sideEffects, ir.dataPolicy])
      .map((reference) => ({ reference, structural: true })),
    ...conditionReferencePaths(ir.trigger?.filter).map((reference) => ({ reference, branch: true })),
  ];
  const issues: ContractValidationIssue[] = [];
  const reported = new Set<string>();
  for (const use of uses) {
    const [root, field, ...nested] = use.reference.split('.');
    if (!root) continue;
    const source = referenceSource(use.reference, byId, aliases);
    if (!source || (source.type !== 'ai_decision' && !derived.has(source.id))) continue;
    const report = (code: ContractValidationIssue['code'], message: string) => {
      const key = `${root}:${use.reference}:${use.target?.id}:${use.port}:${code}:${message}`;
      if (reported.has(key)) return;
      reported.add(key);
      issues.push({ code, stepId: source.id, message });
    };
    if (source.type === 'ai_decision') {
      if (!field || nested.length > 0 || !outputFieldExists(source, field)) {
        report('invalid_workflow_reference', `${use.reference}: 선언된 단일 출력 필드만 참조하세요. result 전체·미선언 필드·중첩 필드는 실행 입력에 사용할 수 없습니다.`);
        continue;
      }
      if (!outputFieldIsRequired(source, field)) {
        report('invalid_workflow_reference', `${source.id}.${field}는 분기 또는 후속 action에서 사용되므로 outputSchema.required에 포함되어야 합니다.`);
      }
    }
    const presentation = isPresentationReference(use.reference, byId, derived, aliases);
    const allowed = presentation ? canReceivePresentation(use, source)
      : source.type === 'ai_decision' && canReceiveDecision(use, source, field!);
    if (!allowed) {
      report('invalid_workflow_schema', `${use.reference} 출력은 ${use.target?.id ?? 'workflow'}.${use.port ?? 'control'} 입력에 사용할 수 없습니다. 문안은 catalog의 purpose:prose 본문 입력에만 연결하세요. 분기·대상·도구·승인·검색·필터는 boolean/enum 판단 또는 호스트의 고정 값으로 정하세요.`);
    }
  }
  return issues;
}

/** Runtime also checks persisted/inferred bindings, independent of save-time validation. */
export function assertWorkflowOutputBoundaries(ir: WorkflowIR, runtimeSources: Record<string, string> = {}): void {
  const issues = validateWorkflowReferences(ir, new Map(ir.steps.map((step) => [step.id, step])), runtimeSources);
  if (issues.length === 0) return;
  throw Object.assign(new Error(issues[0]!.message), { code: 'ai_output_boundary', data: { issues } });
}
