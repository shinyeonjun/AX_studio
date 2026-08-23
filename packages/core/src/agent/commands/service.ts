import {
  designCapabilities,
  getCapability,
  isConnectorAlwaysOn,
} from '../../catalog/index.js';
import {
  CONNECTOR_CATALOG,
  CONNECTOR_IDS,
  getConnectorLabel,
} from '../../catalog/connectors.js';
import {
  capabilityActionName,
  resolveCapability,
} from '../../catalog/capability-graph.js';
import { actionRefFor } from '../../workflow/action-definition.js';
import {
  validateWorkflowContracts,
  type ContractValidationIssue,
} from '../../workflow/contract-validator.js';
import {
  parseWorkflowIR,
  validateWorkflowIR,
  type Step,
  type WorkflowIR,
} from '../../workflow/schema.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import {
  commandAccess,
  PLAIN_CHAT_COMMAND_CONTEXT,
  type AxCommandExecutionContext,
} from './access.js';
import {
  buildDesignToolContext,
  executeDesignTool,
  type DesignToolContext,
  type DesignToolId,
} from '../../design-tools/index.js';
import {
  AX_COMMAND_NAMES,
  AxCommandSchema,
  AxCapabilityInvokeArgsSchema,
  AxWorkflowCreateArgsSchema,
  AxWorkflowDeleteArgsSchema,
  AxSourceFileReadArgsSchema,
  AxSourceFilesListArgsSchema,
  AxSourceListArgsSchema,
  AxSourceSearchArgsSchema,
  AxWorkflowStepInputSchema,
  AxWorkflowUpdateArgsSchema,
  AxWorkflowRunArgsSchema,
  type AxCommand,
  type AxCommandDefinition,
  type AxCommandIssue,
  type AxCommandName,
  type AxCommandResult,
} from './schema.js';

const COMMAND_DEFINITIONS: readonly AxCommandDefinition[] = [
  {
    name: 'command.list',
    description: '이 세션에서 사용할 수 있는 AX 명령 목록을 조회합니다.',
    args: {},
    mutates: false,
  },
  {
    name: 'resource.list',
    description: '연결 상태를 노출하는 안전한 리소스 목록을 조회합니다.',
    args: {},
    mutates: false,
  },
  {
    name: 'source.list',
    description: '연결된 Gmail·Slack·로컬 폴더의 실제 source 목록을 조회합니다.',
    args: { connector: 'connector id (optional)' },
    mutates: false,
  },
  {
    name: 'source.files.list',
    description: '연결된 로컬 폴더의 파일 목록을 조회합니다.',
    args: { folderId: 'connected folder id', extensions: 'array or comma-separated extensions' },
    mutates: false,
  },
  {
    name: 'source.file.read',
    description: '연결된 로컬 폴더 안 PDF의 제한된 본문과 citation을 읽습니다.',
    args: { folderId: 'connected folder id', path: 'file path returned by source.files.list', maxChars: '1000..20000' },
    mutates: false,
  },
  {
    name: 'source.search',
    description: '연결된 로컬 폴더의 검색 인덱스를 조회합니다.',
    args: { query: 'search query', folderId: 'connected folder id', limit: 'positive integer' },
    mutates: false,
  },
  {
    name: 'capability.list',
    description: '현재 연결 상태에서 사용할 수 있는 capability를 조회합니다.',
    args: { connector: 'connector id', kind: 'read | write | trigger' },
    mutates: false,
  },
  {
    name: 'capability.describe',
    description: '하나의 capability 계약과 필요한 파라미터를 조회합니다.',
    args: { id: 'catalog capability id' },
    mutates: false,
  },
  {
    name: 'capability.invoke',
    description: '읽기 전용 capability를 실행합니다. 쓰기 capability는 거부됩니다.',
    args: { id: 'read capability id', params: 'capability parameters' },
    mutates: false,
  },
  {
    name: 'workflow.list',
    description: '저장된 workflow의 식별자와 최신 버전을 조회합니다.',
    args: {},
    mutates: false,
  },
  {
    name: 'workflow.inspect',
    description: '저장된 workflow의 최신 IR과 검증 상태를 조회합니다.',
    args: { workflowId: 'workflow id' },
    mutates: false,
  },
  {
    name: 'workflow.validate',
    description: 'workflow schema, capability 계약, 연결 상태를 검증합니다.',
    args: { workflowId: 'workflow id' },
    mutates: false,
  },
  {
    name: 'workflow.create',
    description: '새 workflow를 즉시 저장합니다. 변경 후 자동으로 새 버전을 만듭니다.',
    args: { name: 'workflow name', goal: 'workflow goal', trigger: 'trigger object', steps: 'step input list' },
    mutates: true,
  },
  {
    name: 'workflow.update',
    description: 'workflow의 허용된 필드와 개별 step을 수정하고 즉시 저장합니다.',
    args: { workflowId: 'workflow id', baseVersion: 'last inspected version', operations: 'set/upsert_step/remove_step list' },
    mutates: true,
  },
  {
    name: 'workflow.delete',
    description: '확인한 버전의 workflow를 삭제합니다.',
    args: { workflowId: 'workflow id', baseVersion: 'last inspected version' },
    mutates: true,
  },
  {
    name: 'workflow.run',
    description: '저장된 workflow를 수동 실행합니다. runtime 승인 정책을 그대로 적용합니다.',
    args: { workflowId: 'workflow id returned by workflow.list' },
    mutates: true,
  },
] as const;

const COMMAND_NAME_SET = new Set<string>(AX_COMMAND_NAMES);

function textArg(command: AxCommand, name: string): string | undefined {
  const value = command.args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function issue(code: string, message: string, path?: string): AxCommandIssue {
  return { code, message, ...(path ? { path } : {}) };
}

function result(
  command: AxCommandName,
  status: AxCommandResult['status'],
  data?: unknown,
  issues: AxCommandIssue[] = [],
): AxCommandResult {
  return { command, status, ...(data === undefined ? {} : { data }), issues };
}

function statusForValidation(issues: ContractValidationIssue[]): AxCommandResult['status'] {
  if (issues.length === 0) return 'ok';
  return issues.every((entry) =>
    entry.code === 'missing_input_contract' || entry.code === 'connector_unavailable',
  )
    ? 'needs_input'
    : 'invalid';
}

function mapContractIssue(entry: ContractValidationIssue): AxCommandIssue {
  return {
    code: entry.code,
    ...(entry.stepId ? { path: `steps.${entry.stepId}` } : {}),
    message: entry.message,
    ...(entry.expected ? { expected: entry.expected } : {}),
    ...(entry.available ? { available: entry.available } : {}),
  };
}

function summarizeCapability(cap: ReturnType<typeof designCapabilities>[number], connected: string[]) {
  return {
    id: cap.id,
    connector: cap.connector,
    kind: cap.kind,
    label: cap.label,
    description: cap.description,
    sideEffect: cap.sideEffect ?? 'NONE',
    params: cap.params.map((param) => ({
      name: param.name,
      label: param.label,
      required: param.required,
    })),
    io: cap.io ?? { inputs: {}, outputs: {} },
    connection:
      isConnectorAlwaysOn(cap.connector) || connected.includes(cap.connector)
        ? 'ready'
        : 'required',
  };
}

/**
 * Single domain gateway for AI-facing commands.
 *
 * This is the single domain gateway for model-facing reads and workflow
 * mutations. Connector-specific policies stay in the existing design-tool
 * handlers; this class only maps the stable AX command names to them.
 */
export class AxCommandService {
  constructor(
    private readonly store: WorkflowStore,
    private readonly options: { runWorkflow?: (workflowId: string) => Promise<unknown> } = {},
  ) {}

  listCommands(executionContext: AxCommandExecutionContext = PLAIN_CHAT_COMMAND_CONTEXT): readonly AxCommandDefinition[] {
    return COMMAND_DEFINITIONS.filter((entry) => commandAccess(entry.name, executionContext).allowed);
  }

  async execute(
    raw: unknown,
    options: {
      designToolContext?: DesignToolContext;
      executionContext?: AxCommandExecutionContext;
    } = {},
  ): Promise<AxCommandResult> {
    const parsed = AxCommandSchema.safeParse(raw);
    if (!parsed.success) {
      return result(
        'command.list',
        'invalid',
        undefined,
        [issue('invalid_command', parsed.error.message)],
      );
    }

    const command = parsed.data;
    const executionContext = options.executionContext ?? PLAIN_CHAT_COMMAND_CONTEXT;
    const access = commandAccess(command.name, executionContext);
    if (!access.allowed) {
      return result(command.name, 'forbidden', undefined, [issue('command_forbidden', access.reason)]);
    }

    switch (command.name) {
      case 'command.list':
        return result(command.name, 'ok', {
          commands: this.listCommands(executionContext),
        });
      case 'resource.list':
        return result(command.name, 'ok', this.listResources());
      case 'source.list':
        return result(command.name, ...await this.executeReadTool(command, 'sources.list', AxSourceListArgsSchema, options.designToolContext));
      case 'source.files.list':
        return result(command.name, ...await this.executeReadTool(command, 'sources.files.list', AxSourceFilesListArgsSchema, options.designToolContext));
      case 'source.file.read':
        return result(command.name, ...await this.executeReadTool(command, 'sources.file.read', AxSourceFileReadArgsSchema, options.designToolContext));
      case 'source.search':
        return result(command.name, ...await this.executeReadTool(command, 'sources.search', AxSourceSearchArgsSchema, options.designToolContext));
      case 'capability.list':
        return result(command.name, 'ok', this.listCapabilities(command));
      case 'capability.describe':
        return result(command.name, ...this.describeCapability(command));
      case 'capability.invoke':
        return result(command.name, ...await this.executeReadTool(command, 'capabilities.invoke', AxCapabilityInvokeArgsSchema, options.designToolContext));
      case 'workflow.list':
        return result(command.name, 'ok', { workflows: this.store.listWorkflows() });
      case 'workflow.inspect':
        return result(command.name, ...this.inspectWorkflow(command));
      case 'workflow.validate':
        return result(command.name, ...this.validateWorkflow(command));
      case 'workflow.create':
        return result(command.name, ...this.createWorkflow(command));
      case 'workflow.update':
        return result(command.name, ...this.updateWorkflow(command));
      case 'workflow.delete':
        return result(command.name, ...this.deleteWorkflow(command));
      case 'workflow.run':
        return result(command.name, ...await this.runWorkflow(command));
    }
  }

  private async runWorkflow(command: AxCommand): Promise<[AxCommandResult['status'], unknown, AxCommandIssue[]?]> {
    const parsed = AxWorkflowRunArgsSchema.safeParse(command.args);
    if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
    if (!this.store.getWorkflow(parsed.data.workflowId)) {
      return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'args.workflowId')]];
    }
    if (!this.options.runWorkflow) {
      return ['error', undefined, [issue('workflow_runner_unavailable', 'workflow 실행기가 연결되지 않았습니다.')]];
    }
    try {
      return ['ok', await this.options.runWorkflow(parsed.data.workflowId)];
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : 'workflow_run_failed';
      return ['error', undefined, [issue(code, error instanceof Error ? error.message : String(error))]];
    }
  }

  private defaultDesignToolContext(): DesignToolContext {
    const connections = this.store.getConnections();
    return buildDesignToolContext(
      connections,
      connections.filter((entry) => entry.connected).map((entry) => entry.connector),
      { interactionMode: 'plain_chat', allowUntrustedData: true },
    );
  }

  private async executeReadTool<T>(
    command: AxCommand,
    tool: DesignToolId,
    argsSchema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { message: string } } },
    designToolContext?: DesignToolContext,
  ): Promise<[AxCommandResult['status'], unknown, AxCommandIssue[]?]> {
    const parsed = argsSchema.safeParse(command.args);
    if (!parsed.success) {
      return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
    }
    const execution = await executeDesignTool(
      { tool, args: parsed.data as Record<string, unknown> },
      designToolContext ?? this.defaultDesignToolContext(),
    );
    if (execution.ok) return ['ok', execution.data];
    const error = execution.error ?? 'source_command_failed';
    const status = error === 'source_content_requires_local_ai' ? 'forbidden' : 'error';
    return [status, undefined, [issue(error, `command ${command.name} 실행 실패: ${error}`)]];
  }

  private listResources() {
    const connections = new Map(
      this.store.getConnections().map((connection) => [connection.connector, connection]),
    );
    return {
      resources: CONNECTOR_IDS.map((id) => {
        const catalog = CONNECTOR_CATALOG[id];
        const connection = connections.get(id);
        return {
          id,
          label: getConnectorLabel(id),
          description: catalog.description,
          connected: isConnectorAlwaysOn(id) || Boolean(connection?.connected),
          connectable: catalog.connectable,
          connectionKind: catalog.connectionKind,
        };
      }),
    };
  }

  private listCapabilities(command: AxCommand) {
    const connector = textArg(command, 'connector');
    const kind = textArg(command, 'kind');
    const connected = this.store
      .getConnections()
      .filter((entry) => entry.connected)
      .map((entry) => entry.connector);
    // Keep disconnected capabilities visible so the agent can distinguish
    // "this action does not exist" from "this connection is not ready".
    let capabilities = designCapabilities();
    if (connector) capabilities = capabilities.filter((entry) => entry.connector === connector);
    if (kind === 'read' || kind === 'write' || kind === 'trigger') {
      capabilities = capabilities.filter((entry) => entry.kind === kind);
    }
    return {
      capabilities: capabilities.map((entry) => summarizeCapability(entry, connected)),
      count: capabilities.length,
    };
  }

  private describeCapability(command: AxCommand): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const id = textArg(command, 'id');
    if (!id) {
      return ['invalid', undefined, [issue('missing_argument', 'capability id가 필요합니다.', 'args.id')]];
    }
    const capability = getCapability(id);
    if (!capability) {
      return ['not_found', undefined, [issue('capability_not_found', `capability를 찾을 수 없습니다: ${id}`, 'args.id')]];
    }
    const connected = this.store
      .getConnections()
      .filter((entry) => entry.connected)
      .map((entry) => entry.connector);
    return ['ok', summarizeCapability(capability, connected)];
  }

  private inspectWorkflow(command: AxCommand): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const workflowId = textArg(command, 'workflowId');
    if (!workflowId) {
      return ['invalid', undefined, [issue('missing_argument', 'workflowId가 필요합니다.', 'args.workflowId')]];
    }
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow) {
      return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${workflowId}`, 'args.workflowId')]];
    }
    const validation = this.validateIR(workflow);
    return [validation.status, { workflow, validation: validation.data }, validation.issues];
  }

  private validateWorkflow(command: AxCommand): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const workflowId = textArg(command, 'workflowId');
    if (!workflowId) {
      return ['invalid', undefined, [issue('missing_argument', 'workflowId가 필요합니다.', 'args.workflowId')]];
    }
    const workflow = this.store.getWorkflow(workflowId);
    if (!workflow) {
      return ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${workflowId}`, 'args.workflowId')]];
    }
    const validation = this.validateIR(workflow);
    return [validation.status, validation.data, validation.issues];
  }

  private createWorkflow(command: AxCommand): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const parsed = AxWorkflowCreateArgsSchema.safeParse(command.args);
    if (!parsed.success) {
      return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
    }

    const steps = this.normalizeStepInputs(parsed.data.steps);
    if (!steps.ok) return ['invalid', undefined, steps.issues];

    const candidate: WorkflowIR = {
      name: parsed.data.name,
      goal: parsed.data.goal,
      version: 1,
      inputs: [],
      trigger: parsed.data.trigger,
      steps: steps.value,
      permissions: {},
      approval: [],
      allowExternalAuto: false,
      success: parsed.data.success,
      assumptions: parsed.data.assumptions,
      sideEffects: sideEffectsFor(steps.value),
      dataPolicy: {},
    };
    return this.persistCandidate(command.name, candidate, 'created');
  }

  private updateWorkflow(command: AxCommand): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const parsed = AxWorkflowUpdateArgsSchema.safeParse(command.args);
    if (!parsed.success) {
      return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
    }

    const current = this.store.getWorkflow(parsed.data.workflowId);
    if (!current) {
      return [
        'not_found',
        undefined,
        [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'workflowId')],
      ];
    }
    if (current.version !== parsed.data.baseVersion) {
      return [
        'conflict',
        { currentVersion: current.version },
        [
          issue(
            'stale_workflow_version',
            `workflow가 ${current.version} 버전으로 변경되었습니다. 최신 버전을 다시 조회해야 합니다.`,
            'baseVersion',
          ),
        ],
      ];
    }

    const next: WorkflowIR = {
      ...current,
      steps: [...current.steps],
      assumptions: [...current.assumptions],
      sideEffects: { ...current.sideEffects },
    };
    const operationIssues: AxCommandIssue[] = [];

    for (const operation of parsed.data.operations) {
      if (operation.op === 'set') {
        const applied = applyWorkflowField(next, operation.path, operation.value);
        if (!applied.ok) operationIssues.push(applied.issue);
        continue;
      }
      if (operation.op === 'remove_step') {
        const index = next.steps.findIndex((step) => step.id === operation.stepId);
        if (index < 0) {
          operationIssues.push(
            issue('step_not_found', `step을 찾을 수 없습니다: ${operation.stepId}`, `steps.${operation.stepId}`),
          );
          continue;
        }
        next.steps.splice(index, 1);
        delete next.sideEffects[operation.stepId];
        continue;
      }

      const normalized = this.normalizeStepInput(operation.step);
      if (!normalized.ok) {
        operationIssues.push(...normalized.issues);
        continue;
      }
      const index = next.steps.findIndex((step) => step.id === normalized.value.id);
      if (index < 0) next.steps.push(normalized.value);
      else next.steps[index] = normalized.value;
      if (normalized.value.type === 'action') {
        next.sideEffects[normalized.value.id] = normalized.value.sideEffect;
      } else {
        delete next.sideEffects[normalized.value.id];
      }
    }

    if (operationIssues.length > 0) return ['invalid', undefined, operationIssues];
    return this.persistCandidate(command.name, next, 'updated');
  }

  private deleteWorkflow(command: AxCommand): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const parsed = AxWorkflowDeleteArgsSchema.safeParse(command.args);
    if (!parsed.success) {
      return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
    }
    const current = this.store.getWorkflow(parsed.data.workflowId);
    if (!current) {
      return [
        'not_found',
        undefined,
        [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'workflowId')],
      ];
    }
    if (current.version !== parsed.data.baseVersion) {
      return [
        'conflict',
        { currentVersion: current.version },
        [issue('stale_workflow_version', '최신 workflow 버전과 일치하지 않습니다.', 'baseVersion')],
      ];
    }
    const deleted = this.store.deleteWorkflow(parsed.data.workflowId);
    return deleted
      ? ['ok', { workflowId: parsed.data.workflowId, deleted: true }]
      : [
          'not_found',
          undefined,
          [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${parsed.data.workflowId}`, 'workflowId')],
        ];
  }

  private persistCandidate(
    command: AxCommandName,
    candidate: WorkflowIR,
    operation: 'created' | 'updated',
  ): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const parsed = validateWorkflowIR(candidate);
    if (!parsed.ok) return ['invalid', undefined, [issue('invalid_workflow_schema', parsed.error)]];
    try {
      const saved = this.store.saveWorkflow(parseWorkflowIR(parsed.value));
      const workflow = this.store.getWorkflow(saved.workflowId, saved.version);
      return ['ok', { operation, workflowId: saved.workflowId, version: saved.version, workflow }];
    } catch (error) {
      const contractIssues = (error as { issues?: ContractValidationIssue[] }).issues;
      if (Array.isArray(contractIssues)) {
        const issues = contractIssues.map(mapContractIssue);
        return [statusForValidation(contractIssues), { saved: false }, issues];
      }
      return [
        'error',
        undefined,
        [issue('workflow_persist_failed', error instanceof Error ? error.message : String(error))],
      ];
    }
  }

  private normalizeStepInputs(inputs: unknown[]) {
    const value: Step[] = [];
    const issues: AxCommandIssue[] = [];
    for (const input of inputs) {
      const normalized = this.normalizeStepInput(input);
      if (!normalized.ok) issues.push(...normalized.issues);
      else value.push(normalized.value);
    }
    return issues.length > 0 ? { ok: false as const, issues } : { ok: true as const, value };
  }

  private normalizeStepInput(input: unknown):
    | { ok: true; value: Step }
    | { ok: false; issues: AxCommandIssue[] } {
    const parsed = AxWorkflowStepInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, issues: [issue('invalid_step', parsed.error.message)] };
    if (parsed.data.type !== 'action') return { ok: true, value: parsed.data as Step };

    const capability = resolveCapability(parsed.data.connector, parsed.data.actionRef ?? parsed.data.action);
    if (!capability || capability.kind === 'trigger') {
      return {
        ok: false,
        issues: [
          issue(
            'unknown_action',
            `catalog에서 action을 찾을 수 없습니다: ${parsed.data.connector}.${parsed.data.action}`,
            `steps.${parsed.data.id}`,
          ),
        ],
      };
    }
    return {
      ok: true,
      value: {
        ...parsed.data,
        connector: capability.connector,
        action: capabilityActionName(capability),
        actionRef: actionRefFor(capability.connector, capabilityActionName(capability)),
        sideEffect: capability.sideEffect ?? 'EXTERNAL',
      },
    };
  }

  private validateIR(workflow: Parameters<typeof validateWorkflowContracts>[0]) {
    const schema = validateWorkflowIR(workflow);
    if (!schema.ok) {
      const issues = [issue('invalid_workflow_schema', schema.error)];
      return { status: 'invalid' as const, data: { valid: false, issues }, issues };
    }
    const connectedConnectors = this.store
      .getConnections()
      .filter((entry) => entry.connected)
      .map((entry) => entry.connector);
    const contractIssues = validateWorkflowContracts(schema.value, { connectedConnectors });
    const issues = contractIssues.map(mapContractIssue);
    return {
      status: statusForValidation(contractIssues),
      data: { valid: contractIssues.length === 0, issues },
      issues,
    };
  }
}

function sideEffectsFor(steps: Step[]): Record<string, WorkflowIR['sideEffects'][string]> {
  return Object.fromEntries(
    steps
      .filter((step): step is Extract<Step, { type: 'action' }> => step.type === 'action')
      .map((step) => [step.id, step.sideEffect]),
  );
}

function applyWorkflowField(
  workflow: WorkflowIR,
  path: 'name' | 'goal' | 'trigger' | 'success' | 'assumptions',
  value: unknown,
): { ok: true } | { ok: false; issue: AxCommandIssue } {
  if (path === 'name' || path === 'goal' || path === 'success') {
    if (typeof value !== 'string' || (path !== 'success' && !value.trim())) {
      return { ok: false, issue: issue('invalid_field', `${path}는 문자열이어야 합니다.`, path) };
    }
    workflow[path] = value;
    return { ok: true };
  }
  if (path === 'assumptions') {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      return { ok: false, issue: issue('invalid_field', 'assumptions는 문자열 배열이어야 합니다.', path) };
    }
    workflow.assumptions = value;
    return { ok: true };
  }
  if (value == null) {
    workflow.trigger = undefined;
    return { ok: true };
  }
  const trigger = validateWorkflowIR({ ...workflow, trigger: value });
  if (!trigger.ok) return { ok: false, issue: issue('invalid_trigger', trigger.error, path) };
  workflow.trigger = trigger.value.trigger;
  return { ok: true };
}

export function isAxCommandName(value: string): value is AxCommandName {
  return COMMAND_NAME_SET.has(value);
}
