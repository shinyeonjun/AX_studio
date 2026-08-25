import { canSatisfyInput, contractTypesCompatible, mergeAvailableTypes } from '../contracts/compatibility.js';
import type { ContractTypeName } from '../contracts/capability-io.js';
import {
  actionInputTypes,
  actionOutputTypes,
} from '../catalog/capability-contracts.js';
import { resolveCapability } from '../catalog/capability-graph.js';
import { isConnectorAlwaysOn } from '../catalog/capability-graph.js';
import { getConnectorCatalogEntry } from '../catalog/connectors.js';
import { linearContractSteps, stepsById } from './control-flow.js';
import type { Step, WorkflowIR } from './schema.js';
import { aiDecisionOutputPorts, bindingsSatisfyInputs, bindingOutputType, hasConcreteParamForPort, triggerAvailableTypes } from './bindings.js';
import { actionRefFor, resolveActionDefinition, validateActionParams } from './action-definition.js';
import { resolveEffectiveSideEffect } from './side-effect-resolve.js';
import { isValidCronExpression } from './cron.js';

export type BindingSource = string | 'trigger';

export interface ContractValidationIssue {
  code:
    | 'missing_input_contract'
    | 'unknown_action_contract'
    | 'connector_unavailable'
    | 'invalid_workflow_reference'
    | 'invalid_workflow_schema'
    | 'invalid_control_flow';
  stepId?: string;
  message: string;
  expected?: ContractTypeName[];
  available?: ContractTypeName[];
}

export interface WorkflowContractValidationOptions {
  /** Explicit runtime implementations supplied by a test or host process. */
  runtimeConnectors?: Record<string, unknown>;
  /** Persisted connection ids available to the desktop host. */
  connectedConnectors?: string[];
}

function referencePaths(value: unknown): string[] {
  if (typeof value === 'string') {
    return [...value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]!.trim());
  }
  if (Array.isArray(value)) return value.flatMap(referencePaths);
  if (!value || typeof value !== 'object') return [];
  const record = value as Record<string, unknown>;
  if (Object.keys(record).length === 1 && typeof record.ref === 'string') return [record.ref.trim()];
  return Object.values(record).flatMap(referencePaths);
}

function conditionReferencePaths(condition: unknown): string[] {
  if (!condition || typeof condition !== 'object') return [];
  const record = condition as Record<string, unknown>;
  if (record.op === 'and' || record.op === 'or') {
    return Array.isArray(record.args) ? record.args.flatMap(conditionReferencePaths) : [];
  }
  if (record.op === 'not') return conditionReferencePaths(record.arg);
  return [record.left, record.right].flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const ref = (value as Record<string, unknown>).ref;
    return typeof ref === 'string' ? [ref] : [];
  });
}

function outputFieldExists(step: Extract<Step, { type: 'ai_decision' }>, field: string): boolean {
  // AI output references are data-contract references. A missing schema cannot
  // prove that a field exists, so it must be reported before execution.
  if (!step.outputSchema) return false;
  const properties = step.outputSchema?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return false;
  return Object.prototype.hasOwnProperty.call(properties, field);
}

function outputFieldIsRequired(step: Extract<Step, { type: 'ai_decision' }>, field: string): boolean {
  return Array.isArray(step.outputSchema?.required) && step.outputSchema.required.includes(field);
}

function validateTriggerConfiguration(ir: WorkflowIR): ContractValidationIssue[] {
  const trigger = ir.trigger;
  if (!trigger) return [];

  const requiredFields: Array<[string, string | undefined]> =
    trigger.type === 'schedule'
      ? [
          ['schedule', trigger.schedule],
          ['timezone', trigger.timezone],
        ]
      : trigger.type === 'once'
        ? [['runAt', trigger.runAt]]
        : trigger.type === 'gmail.new_message'
          ? [['accountId', trigger.accountId]]
          : trigger.type === 'slack.new_message'
            ? [['channel', trigger.channel]]
            : trigger.type === 'local_folder.new_file'
              ? [['folderId', trigger.folderId]]
              : trigger.type === 'webhook.inbound'
                ? [['path', trigger.path]]
                : [];

  const issues = requiredFields.flatMap(([field, value]) =>
    typeof value === 'string' && value.trim().length > 0
      ? []
      : [
          {
            code: 'invalid_workflow_schema' as const,
            message: `${trigger.type} 트리거에 ${field} 값이 필요합니다.`,
          },
        ],
  );
  if (
    trigger.type === 'schedule' &&
    trigger.schedule.trim() &&
    !isValidCronExpression(trigger.schedule)
  ) {
    issues.push({
      code: 'invalid_workflow_schema',
      message: `schedule cron 표현식이 올바르지 않습니다: ${trigger.schedule}`,
    });
  }
  return issues;
}

import { documentIngestPathSatisfied } from './ingest-source.js';

function bindingForParameter(
  step: Extract<Step, { type: 'action' }>,
  parameter: string,
): boolean {
  if (step.bindings?.[parameter]) return true;
  const aliases: Record<string, string> = {
    path: 'source',
    messageId: 'message',
  };
  return Boolean(step.bindings?.[aliases[parameter] ?? '']);
}

function actionParamConfigured(
  step: Extract<Step, { type: 'action' }>,
  parameter: string,
): boolean {
  if (parameter === 'path' && documentIngestPathSatisfied(step)) return true;
  if (bindingForParameter(step, parameter)) return true;
  const value = step.params[parameter];
  if (value == null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

function validateActionConfiguration(
  step: Extract<Step, { type: 'action' }>,
): ContractValidationIssue[] {
  const definition = resolveActionDefinition(step.actionRef ?? actionRefFor(step.connector, step.action));
  if (!definition) return [];

  const missing = validateActionParams(definition, step.params).filter(
    (parameter) => !actionParamConfigured(step, parameter),
  );
  if (missing.length === 0) return [];

  return [
    {
      code: 'invalid_workflow_schema',
      stepId: step.id,
      message: `${definition.id} 단계에 필요한 값이 없습니다: ${missing.join(', ')}`,
    },
  ];
}

function validateWorkflowStructure(
  ir: WorkflowIR,
  options: WorkflowContractValidationOptions = {},
): ContractValidationIssue[] {
  const issues: ContractValidationIssue[] = [...validateTriggerConfiguration(ir)];
  const byId = new Map<string, Step>();
  for (const step of ir.steps) {
    if (byId.has(step.id)) {
      issues.push({ code: 'invalid_control_flow', stepId: step.id, message: `노드 id가 중복되었습니다: ${step.id}` });
    }
    byId.set(step.id, step);
  }

  for (const step of ir.steps) {
    if (step.type === 'action') {
      const capability = resolveCapability(step.connector, step.action);
      if (!capability) {
        issues.push({
          code: 'unknown_action_contract',
          stepId: step.id,
          message: `지원하지 않는 action입니다: ${step.connector}.${step.action}`,
        });
      } else if (
        getConnectorCatalogEntry(step.connector)?.runtimeAvailable !== true &&
        !options.runtimeConnectors?.[step.connector]
      ) {
        issues.push({
          code: 'connector_unavailable',
          stepId: step.id,
          message: `${step.connector}는 현재 실행 구현이 없어 이 workflow에서 사용할 수 없습니다.`,
        });
      } else if (
        options.connectedConnectors &&
        !isConnectorAlwaysOn(step.connector) &&
        !options.connectedConnectors.includes(step.connector)
      ) {
        issues.push({
          code: 'connector_unavailable',
          stepId: step.id,
          message: `${step.connector} 연결이 없어 이 workflow를 저장할 수 없습니다.`,
        });
      }
      const definition = resolveActionDefinition(step.actionRef ?? actionRefFor(step.connector, step.action));
      if (definition) {
        if (step.connector !== definition.connector || step.action !== definition.action) {
          issues.push({
            code: 'invalid_workflow_schema',
            stepId: step.id,
            message: `${step.id} actionRef와 connector/action이 일치하지 않습니다: ${definition.id}`,
          });
        }
        const expectedSideEffect = resolveEffectiveSideEffect(definition, step.params ?? {});
        if (step.sideEffect !== expectedSideEffect) {
          issues.push({
            code: 'invalid_workflow_schema',
            stepId: step.id,
            message: `${step.id} sideEffect가 catalog와 다릅니다. ${expectedSideEffect}를 사용해야 합니다.`,
          });
        }
      }
    }
    if (step.type === 'if') {
      if (step.thenStepIds.length === 0) {
        issues.push({ code: 'invalid_control_flow', stepId: step.id, message: `${step.id} if 노드에 thenStepIds가 필요합니다.` });
      }
      for (const targetId of [...step.thenStepIds, ...(step.elseStepIds ?? [])]) {
        if (!byId.has(targetId)) {
          issues.push({ code: 'invalid_control_flow', stepId: step.id, message: `${step.id}가 존재하지 않는 노드 ${targetId}를 가리킵니다.` });
        }
        if (targetId === step.id) {
          issues.push({ code: 'invalid_control_flow', stepId: step.id, message: `${step.id} if 노드는 자기 자신을 가리킬 수 없습니다.` });
        }
      }
    }
    if (step.type === 'human_approval') {
      if (step.forActionIds.length === 0) {
        issues.push({
          code: 'invalid_control_flow',
          stepId: step.id,
          message: `${step.id} 승인 노드에 승인 대상 action이 필요합니다.`,
        });
      }
      for (const actionId of step.forActionIds) {
        const target = byId.get(actionId);
        if (!target || target.type !== 'action') {
          issues.push({
            code: 'invalid_control_flow',
            stepId: step.id,
            message: `${step.id} 승인 노드가 action이 아닌 ${actionId}를 가리킵니다.`,
          });
        }
      }
    }
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const reportedCycles = new Set<string>();
  const visit = (stepId: string, path: string[]) => {
    if (visiting.has(stepId)) {
      const start = path.indexOf(stepId);
      const cycle = [...path.slice(start >= 0 ? start : 0), stepId].join(' -> ');
      if (!reportedCycles.has(cycle)) {
        reportedCycles.add(cycle);
        issues.push({
          code: 'invalid_control_flow',
          stepId,
          message: `if 분기 순환이 발견되었습니다: ${cycle}`,
        });
      }
      return;
    }
    if (visited.has(stepId)) return;

    const current = byId.get(stepId);
    if (!current) return;
    visiting.add(stepId);
    if (current.type === 'if') {
      for (const targetId of [...current.thenStepIds, ...(current.elseStepIds ?? [])]) {
        visit(targetId, [...path, targetId]);
      }
    }
    visiting.delete(stepId);
    visited.add(stepId);
  };

  for (const step of ir.steps) visit(step.id, [step.id]);

  const notifyActions = ir.steps.filter(
    (step): step is Extract<Step, { type: 'action' }> =>
      step.type === 'action' &&
      ((step.connector === 'slack' && /message\.send|send/.test(step.action)) ||
        (step.connector === 'gmail' && /message\.send|send/.test(step.action))),
  );
  const decisionSteps = ir.steps.filter((step) => step.type === 'ai_decision');
  const branchSteps = ir.steps.filter((step) => step.type === 'if');
  if (notifyActions.length >= 2 && decisionSteps.length > 0 && branchSteps.length === 0) {
    issues.push({
      code: 'invalid_control_flow',
      message: 'AI 분류 결과를 사용하는 알림은 if 분기로 목적지를 나눠야 합니다.',
    });
  }
  if (notifyActions.length >= 2 && decisionSteps.length > 0 && branchSteps.length > 0) {
    const branchEntries = new Set(branchSteps.flatMap((step) => [...step.thenStepIds, ...(step.elseStepIds ?? [])]));
    for (const approval of ir.steps) {
      if (approval.type === 'human_approval' && branchEntries.has(approval.id)) {
        approval.forActionIds.forEach((actionId) => branchEntries.add(actionId));
      }
    }
    for (const action of notifyActions) {
      if (!branchEntries.has(action.id)) {
        issues.push({
          code: 'invalid_control_flow',
          stepId: action.id,
          message: `${action.id} 알림 action이 if 분기에 연결되지 않았습니다.`,
        });
      }
    }
  }

  const refs = ir.steps.flatMap((step) => {
    if (step.type === 'if') return conditionReferencePaths(step.condition);
    if (step.type === 'action') {
      const bindingRefs = Object.values(step.bindings ?? {})
        .filter((binding) => binding.from !== 'trigger')
        .map((binding) => `${binding.from}.${binding.output}`);
      return [...referencePaths(step.params), ...bindingRefs];
    }
    return [];
  });
  const reportedReferences = new Set<string>();
  for (const reference of refs) {
    const [root, field] = reference.split('.', 2);
    if (!root || !field || root === 'trigger' || (ir.inputs ?? []).includes(root)) continue;
    const source = byId.get(root);
    if (!source || source.type !== 'ai_decision') continue;
    if (!outputFieldExists(source, field)) {
      const issueKey = `${source.id}:${field}:declared`;
      if (reportedReferences.has(issueKey)) continue;
      reportedReferences.add(issueKey);
      issues.push({
        code: 'invalid_workflow_reference',
        stepId: source.id,
        message: `${source.id} 결과에 선언되지 않은 출력 필드 ${field}를 참조합니다.`,
      });
      continue;
    }
    if (!outputFieldIsRequired(source, field)) {
      const issueKey = `${source.id}:${field}:required`;
      if (reportedReferences.has(issueKey)) continue;
      reportedReferences.add(issueKey);
      issues.push({
        code: 'invalid_workflow_reference',
        stepId: source.id,
        message: `${source.id}.${field}는 분기 또는 후속 action에서 사용되므로 outputSchema.required에 포함되어야 합니다.`,
      });
    }
  }
  return issues;
}

function actionHasConcreteInputs(
  step: Extract<Step, { type: 'action' }>,
  ir: WorkflowIR,
  guaranteedSources: Set<BindingSource>,
): boolean {
  if (bindingsSatisfyInputs(step, ir, guaranteedSources)) {
    return true;
  }

  const cap = resolveCapability(step.connector, step.action);
  for (const [inputPort] of Object.entries(cap?.io?.inputs ?? {})) {
    if (hasConcreteParamForPort(step, inputPort)) return true;
  }
  return false;
}

function stepContractIssues(
  step: Step,
  available: ContractTypeName[],
  ir: WorkflowIR,
  guaranteedSources: Set<BindingSource>,
): { issues: ContractValidationIssue[]; nextAvailable: ContractTypeName[] } {
  if (step.type === 'ai_decision') {
    const issues: ContractValidationIssue[] = [];
    const contracts = step.inputContracts ?? {};
    for (const [port, contract] of Object.entries(contracts)) {
      const binding = step.bindings?.[port];
      if (!binding) {
        issues.push({
          code: 'missing_input_contract',
          stepId: step.id,
          message: `${step.id} AI 단계에 ${port}(${contract}) 입력 바인딩이 필요합니다.`,
          expected: [contract],
          available,
        });
        continue;
      }
      const sourceType = bindingOutputType(binding, ir);
      if (!sourceType || !contractTypesCompatible(sourceType, contract)) {
        issues.push({
          code: 'missing_input_contract',
          stepId: step.id,
          message: `${step.id}.${port} 바인딩이 ${contract} 계약과 호환되지 않습니다.`,
          expected: [contract],
          available: sourceType ? [sourceType] : available,
        });
      } else if (binding.from !== 'trigger' && !guaranteedSources.has(binding.from)) {
        issues.push({
          code: 'missing_input_contract',
          stepId: step.id,
          message: `${step.id}.${port} 바인딩 소스 ${binding.from}가 보장된 실행 경로에 없습니다.`,
          expected: [contract],
          available,
        });
      }
    }
    return {
      issues,
      nextAvailable: mergeAvailableTypes(available, aiDecisionOutputPorts(step).map((port) => port.type)),
    };
  }

  if (step.type !== 'action') {
    return { issues: [], nextAvailable: available };
  }

  const requiredInputs = actionInputTypes(step.connector, step.action);
  if (requiredInputs.length === 0) {
    return {
      issues: [],
      nextAvailable: mergeAvailableTypes(available, actionOutputTypes(step.connector, step.action)),
    };
  }

  if (bindingsSatisfyInputs(step, ir, guaranteedSources) || actionHasConcreteInputs(step, ir, guaranteedSources)) {
    return {
      issues: [],
      nextAvailable: mergeAvailableTypes(available, actionOutputTypes(step.connector, step.action)),
    };
  }

  const missing = requiredInputs.filter((input) => !canSatisfyInput(available, input));
  if (missing.length > 0) {
    return {
      issues: [
        {
          code: 'missing_input_contract',
          stepId: step.id,
          message: `${step.connector}.${step.action} 단계에 필요한 데이터 계약을 이전 단계나 트리거가 제공하지 않습니다.`,
          expected: missing,
          available,
        },
      ],
      nextAvailable: available,
    };
  }

  return {
    issues: [],
    nextAvailable: mergeAvailableTypes(available, actionOutputTypes(step.connector, step.action)),
  };
}

function addedTypes(base: ContractTypeName[], end: ContractTypeName[]): ContractTypeName[] {
  return end.filter((type) => !base.includes(type));
}

/** After IF, only types produced on every branch remain guaranteed. */
function mergeBranchAvailability(
  base: ContractTypeName[],
  thenAvailable: ContractTypeName[],
  elseAvailable: ContractTypeName[],
): ContractTypeName[] {
  const thenAdded = addedTypes(base, thenAvailable);
  const elseAdded = addedTypes(base, elseAvailable);
  const shared = thenAdded.filter((type) => elseAdded.includes(type));
  return mergeAvailableTypes(base, shared);
}

function mergeGuaranteedSources(
  base: Set<BindingSource>,
  thenSources: Set<BindingSource>,
  elseSources: Set<BindingSource>,
): Set<BindingSource> {
  const sharedBranchSteps = [...thenSources].filter(
    (source) => source !== 'trigger' && elseSources.has(source),
  );
  return new Set([...base, ...sharedBranchSteps]);
}

function validateSequence(
  sequence: Step[],
  available: ContractTypeName[],
  guaranteedSources: Set<BindingSource>,
  ir: WorkflowIR,
  allSteps: Step[],
): { issues: ContractValidationIssue[]; available: ContractTypeName[]; guaranteedSources: Set<BindingSource> } {
  let current = available;
  let currentGuaranteed = new Set(guaranteedSources);
  const issues: ContractValidationIssue[] = [];

  for (const step of sequence) {
    if (step.type === 'if') {
      const guard = stepContractIssues(step, current, ir, currentGuaranteed);
      issues.push(...guard.issues);

      const thenResult = validateSequence(
        stepsById(allSteps, step.thenStepIds),
        current,
        currentGuaranteed,
        ir,
        allSteps,
      );
      const elseResult = validateSequence(
        stepsById(allSteps, step.elseStepIds ?? []),
        current,
        currentGuaranteed,
        ir,
        allSteps,
      );
      issues.push(...thenResult.issues, ...elseResult.issues);
      current = mergeBranchAvailability(current, thenResult.available, elseResult.available);
      currentGuaranteed = mergeGuaranteedSources(
        currentGuaranteed,
        thenResult.guaranteedSources,
        elseResult.guaranteedSources,
      );
      continue;
    }

    const result = stepContractIssues(step, current, ir, currentGuaranteed);
    issues.push(...result.issues);
    current = result.nextAvailable;
    currentGuaranteed.add(step.id);
  }

  return { issues, available: current, guaranteedSources: currentGuaranteed };
}

export function validateWorkflowContracts(
  ir: WorkflowIR,
  options: WorkflowContractValidationOptions = {},
): ContractValidationIssue[] {
  const structuralIssues = validateWorkflowStructure(ir, options);
  // Do not enter the recursive contract walk after a graph cycle has already
  // been identified. The graph is invalid and descending it would recurse
  // forever before the caller can surface the actionable validation issue.
  if (structuralIssues.some((issue) => issue.message.startsWith('if 분기 순환이 발견되었습니다:'))) {
    return structuralIssues;
  }
  const linear = linearContractSteps(ir.steps);
  const available = triggerAvailableTypes(ir.trigger, ir.inputs ?? []);
  return [...structuralIssues, ...validateSequence(linear, available, new Set(['trigger']), ir, ir.steps).issues];
}

/** Validation required before persisting an executable workflow version. */
export function validateWorkflowForPersistence(
  ir: WorkflowIR,
  options: WorkflowContractValidationOptions = {},
): ContractValidationIssue[] {
  const issues = validateWorkflowContracts(ir, options);
  for (const step of ir.steps) {
    if (step.type === 'action') issues.push(...validateActionConfiguration(step));
  }
  return issues;
}

export function validateWorkflowContractsOrThrow(ir: WorkflowIR): void {
  const issues = validateWorkflowContracts(ir);
  if (issues.length === 0) return;
  const first = issues[0]!;
  const error = new Error(first.message) as Error & { code: string; issues: ContractValidationIssue[] };
  error.code = 'contract_validation_failed';
  error.issues = issues;
  throw error;
}
