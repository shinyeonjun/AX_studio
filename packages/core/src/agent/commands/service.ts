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
import type { WorkflowStore } from '../../store/workflow-store.js';
import type { ArtifactStore } from '../../store/artifact-store.js';
import {
  WorkspaceSourceError,
  type WorkspaceSourceService,
} from '../../store/workspace-source-service.js';
import {
  commandAccess,
  HOST_COMMAND_CONTEXT,
  type AxCommandExecutionContext,
} from './access.js';
import {
  createDesignToolReadGateway,
  type AxCommandReadContext,
  type AxCommandReadGateway,
  type AxCommandReadTool,
} from './read-gateway.js';
import {
  createWorkflowCommandGateway,
  type AxWorkflowCommandGateway,
} from './workflow-gateway.js';
import {
  createDiscoveryCommandGateway,
  type DiscoveryCommandGateway,
} from './discovery-gateway.js';
import {
  DiscoveryCancelArgsSchema,
  DiscoveryInspectArgsSchema,
  DiscoveryStartArgsSchema,
} from '../../work-discovery/schema.js';
import {
  AX_COMMAND_NAMES,
  AxCommandSchema,
  AxCapabilityInvokeArgsSchema,
  AxSourceFileReadArgsSchema,
  AxSourceFilesListArgsSchema,
  AxSourceListArgsSchema,
  AxSourceSearchArgsSchema,
  AxSessionSourceListArgsSchema,
  AxSessionSourceReadArgsSchema,
  AxUiPresentArgsSchema,
  type AxCommand,
  type AxCommandDefinition,
  type AxCommandIssue,
  type AxCommandLifecycle,
  type AxCommandName,
  type AxCommandResult,
} from './schema.js';

const COMMAND_DEFINITIONS: readonly AxCommandDefinition[] = [
  {
    name: 'command.list',
    lifecycle: 'read',
    description: '이 세션에서 사용할 수 있는 AX 명령 목록을 조회합니다.',
    args: {},
    mutates: false,
  },
  {
    name: 'resource.list',
    lifecycle: 'read',
    description: '연결 상태를 노출하는 안전한 리소스 목록을 조회합니다.',
    args: {},
    mutates: false,
  },
  {
    name: 'source.list',
    lifecycle: 'read',
    description: '연결된 Gmail·Slack·로컬 폴더의 실제 source 목록을 조회합니다.',
    args: { connector: 'connector id (optional)' },
    mutates: false,
  },
  {
    name: 'source.files.list',
    lifecycle: 'read',
    description: '연결된 로컬 폴더의 파일 목록을 조회합니다.',
    args: { folderId: 'connected folder id', extensions: 'array or comma-separated extensions' },
    mutates: false,
  },
  {
    name: 'source.file.read',
    lifecycle: 'read',
    description: '연결된 로컬 폴더 안 PDF의 제한된 본문과 citation을 읽습니다.',
    args: { folderId: 'connected folder id', path: 'file path returned by source.files.list', maxChars: '1000..20000' },
    mutates: false,
  },
  {
    name: 'source.search',
    lifecycle: 'read',
    description: '연결된 로컬 폴더의 검색 인덱스를 조회합니다.',
    args: { query: 'search query', folderId: 'connected folder id', limit: 'positive integer' },
    mutates: false,
  },
  {
    name: 'session.source.list',
    lifecycle: 'read',
    description: '현재 대화 세션에 업로드된 자료와 문서 엔진 상태를 조회합니다.',
    args: {},
    mutates: false,
  },
  {
    name: 'session.source.read',
    lifecycle: 'read',
    description: '현재 대화 세션의 준비된 문서에서 제한된 Docling 본문과 페이지 근거를 읽습니다.',
    args: { sourceId: 'session.source.list에서 반환한 source id', maxChars: '1000..20000' },
    mutates: false,
  },
  {
    name: 'capability.list',
    lifecycle: 'read',
    description: '현재 연결 상태에서 사용할 수 있는 capability를 조회합니다.',
    args: { connector: 'connector id', kind: 'read | write | trigger' },
    mutates: false,
  },
  {
    name: 'capability.describe',
    lifecycle: 'read',
    description: '하나의 capability 계약과 필요한 파라미터를 조회합니다.',
    args: { id: 'catalog capability id' },
    mutates: false,
  },
  {
    name: 'capability.invoke',
    lifecycle: 'read',
    description: '읽기 전용 capability를 실행합니다. 쓰기 capability는 거부됩니다.',
    args: { id: 'read capability id', params: 'capability parameters' },
    mutates: false,
  },
  {
    name: 'workflow.list',
    lifecycle: 'read',
    description: '저장된 workflow의 식별자와 최신 버전을 조회합니다.',
    args: {},
    mutates: false,
  },
  {
    name: 'workflow.inspect',
    lifecycle: 'read',
    description: '저장된 workflow의 최신 IR과 검증 상태를 조회합니다.',
    args: { workflowId: 'workflow id' },
    mutates: false,
  },
  {
    name: 'workflow.validate',
    lifecycle: 'read',
    description: 'workflow schema, capability 계약, 연결 상태를 검증합니다.',
    args: { workflowId: 'workflow id' },
    mutates: false,
  },
  {
    name: 'workflow.create',
    lifecycle: 'workflow',
    description: '새 workflow를 즉시 저장합니다. 변경 후 자동으로 새 버전을 만듭니다.',
    args: { name: 'workflow name', goal: 'workflow goal', trigger: 'trigger object', steps: 'step input list' },
    mutates: true,
  },
  {
    name: 'workflow.update',
    lifecycle: 'workflow',
    description: 'workflow의 허용된 필드와 개별 step을 수정하고 즉시 저장합니다.',
    args: { workflowId: 'workflow id', baseVersion: 'last inspected version', operations: 'set/upsert_step/remove_step list' },
    mutates: true,
  },
  {
    name: 'workflow.delete',
    lifecycle: 'workflow',
    description: '확인한 버전의 workflow를 삭제합니다.',
    args: { workflowId: 'workflow id', baseVersion: 'last inspected version' },
    mutates: true,
  },
  {
    name: 'workflow.run',
    lifecycle: 'run',
    description: '저장된 workflow를 수동 실행합니다. runtime 승인 정책을 그대로 적용합니다.',
    args: { workflowId: 'workflow id returned by workflow.list' },
    mutates: true,
  },
  {
    name: 'execution.enqueue_once',
    lifecycle: 'ephemeral',
    description: '검증된 계획을 저장하지 않고 일회 실행 큐에 등록합니다. 실행 결과는 activity와 approval 로그에 남습니다.',
    args: { name: '실행 이름', goal: '실행 목적', trigger: '선택적 trigger', steps: 'step input list' },
    mutates: true,
  },
  {
    name: 'ui.present',
    lifecycle: 'present',
    description: '필요할 때만 검토·선택·입력을 위한 안전한 UI 카드를 대화에 표시합니다. 외부 작업은 실행하지 않습니다.',
    args: { title: '카드 제목', blocks: '근거·판단·단계·안내 블록', inputs: '필요한 입력 목록', actions: '사용자 응답 버튼 목록' },
    mutates: false,
  },
  {
    name: 'discovery.start',
    lifecycle: 'workflow',
    description: '지난 결과물 예시로 업무 발견을 시작합니다.',
    args: { goal: '업무 목표', exampleArtifactIds: 'artifact id list', inputArtifactIds: 'optional input artifacts' },
    mutates: true,
  },
  {
    name: 'discovery.inspect',
    lifecycle: 'read',
    description: '업무 발견 세션 상태를 조회합니다.',
    args: { sessionId: 'discovery session id' },
    mutates: false,
  },
  {
    name: 'discovery.cancel',
    lifecycle: 'workflow',
    description: '진행 중인 업무 발견을 취소합니다.',
    args: { sessionId: 'discovery session id' },
    mutates: true,
  },
  {
    name: 'discovery.answer',
    lifecycle: 'workflow',
    description: '모호한 후보에 대한 사용자 답변을 반영합니다.',
    args: { sessionId: 'discovery session id', questionId: 'question id', optionId: 'selected option id' },
    mutates: true,
  },
  {
    name: 'discovery.publish',
    lifecycle: 'workflow',
    description: 'replay를 통과한 업무안을 workflow로 저장합니다.',
    args: { sessionId: 'discovery session id', name: 'optional workflow name' },
    mutates: true,
  },
] as const satisfies readonly (AxCommandDefinition & { lifecycle: AxCommandLifecycle })[];

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
  return { command, status, ...(data === undefined ? {} : { data }), issues, inputRequests: [] };
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
    private readonly options: {
      runWorkflow?: (workflowId: string) => Promise<unknown>;
      enqueueOnce?: (workflow: import('../../workflow/schema.js').WorkflowIR) => Promise<unknown> | unknown;
      readGateway?: AxCommandReadGateway;
      artifactStore?: ArtifactStore;
      workspaceSources?: WorkspaceSourceService;
    } = {},
  ) {
    this.readGateway = options.readGateway ?? createDesignToolReadGateway(store);
    this.workflowGateway = createWorkflowCommandGateway(store, options);
    this.discoveryGateway = createDiscoveryCommandGateway(store, { artifactStore: options.artifactStore });
  }

  private readonly readGateway: AxCommandReadGateway;
  private readonly workflowGateway: AxWorkflowCommandGateway;
  private readonly discoveryGateway: DiscoveryCommandGateway;

  /**
   * Omitted context means an untrusted host caller. Agent callers must opt in
   * explicitly so a forgotten boundary cannot gain workflow/run authority.
   */
  listCommands(executionContext: AxCommandExecutionContext = HOST_COMMAND_CONTEXT): readonly AxCommandDefinition[] {
    return COMMAND_DEFINITIONS.filter((entry) => commandAccess(entry, executionContext).allowed);
  }

  async execute(
    raw: unknown,
    options: {
      designToolContext?: AxCommandReadContext;
      designToolContextFactory?: () => AxCommandReadContext;
      executionContext?: AxCommandExecutionContext;
      workspaceSessionId?: string;
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
    const executionContext = options.executionContext ?? HOST_COMMAND_CONTEXT;
    const definition = COMMAND_DEFINITIONS.find((entry) => entry.name === command.name);
    if (!definition) {
      return result(command.name, 'invalid', undefined, [issue('unknown_command', command.name)]);
    }
    const access = commandAccess(definition, executionContext);
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
        return result(command.name, ...await this.executeReadTool(command, 'sources.list', AxSourceListArgsSchema, options.designToolContext, options.designToolContextFactory));
      case 'source.files.list':
        return result(command.name, ...await this.executeReadTool(command, 'sources.files.list', AxSourceFilesListArgsSchema, options.designToolContext, options.designToolContextFactory));
      case 'source.file.read':
        return result(command.name, ...await this.executeReadTool(command, 'sources.file.read', AxSourceFileReadArgsSchema, options.designToolContext, options.designToolContextFactory));
      case 'source.search':
        return result(command.name, ...await this.executeReadTool(command, 'sources.search', AxSourceSearchArgsSchema, options.designToolContext, options.designToolContextFactory));
      case 'session.source.list':
        return result(command.name, ...this.listSessionSources(command, options.workspaceSessionId));
      case 'session.source.read':
        return result(command.name, ...this.readSessionSource(command, options.workspaceSessionId));
      case 'capability.list':
        return result(command.name, 'ok', this.listCapabilities(command));
      case 'capability.describe':
        return result(command.name, ...this.describeCapability(command));
      case 'capability.invoke':
        return result(command.name, ...await this.executeReadTool(command, 'capabilities.invoke', AxCapabilityInvokeArgsSchema, options.designToolContext, options.designToolContextFactory));
      case 'workflow.list':
        return result(command.name, 'ok', this.workflowGateway.list());
      case 'workflow.inspect':
        return result(command.name, ...this.workflowGateway.inspect(command));
      case 'workflow.validate':
        return result(command.name, ...this.workflowGateway.validate(command));
      case 'workflow.create':
        return result(command.name, ...this.workflowGateway.create(command));
      case 'workflow.update':
        return result(command.name, ...this.workflowGateway.update(command));
      case 'workflow.delete':
        return result(command.name, ...this.workflowGateway.delete(command));
      case 'workflow.run':
        return result(command.name, ...await this.workflowGateway.run(command));
      case 'execution.enqueue_once':
        return result(command.name, ...await this.workflowGateway.enqueueOnce(command));
      case 'ui.present':
        return result(command.name, ...this.presentUi(command));
      case 'discovery.start':
        return result(command.name, ...this.discoveryGateway.start(command));
      case 'discovery.inspect':
        return result(command.name, ...this.discoveryGateway.inspect(command));
      case 'discovery.cancel':
        return result(command.name, ...this.discoveryGateway.cancel(command));
      case 'discovery.answer':
        return result(command.name, ...this.discoveryGateway.answer(command));
      case 'discovery.publish':
        return result(command.name, ...this.discoveryGateway.publish(command));
    }
  }

  private presentUi(command: AxCommand): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const parsed = AxUiPresentArgsSchema.safeParse(command.args);
    if (!parsed.success) {
      return ['invalid', undefined, [issue('invalid_presentation', parsed.error.message)]];
    }
    return ['ok', { presentation: parsed.data }];
  }

  private async executeReadTool<T>(
    command: AxCommand,
    tool: AxCommandReadTool,
    argsSchema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false; error: { message: string } } },
    designToolContext?: AxCommandReadContext,
    designToolContextFactory?: () => AxCommandReadContext,
  ): Promise<[AxCommandResult['status'], unknown, AxCommandIssue[]?]> {
    const parsed = argsSchema.safeParse(command.args);
    if (!parsed.success) {
      return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
    }
    const execution = await this.readGateway.execute(
      { tool, args: parsed.data as Record<string, unknown> },
      designToolContext ?? designToolContextFactory?.(),
    );
    if (execution.ok) return ['ok', execution.data];
    const error = execution.error ?? 'source_command_failed';
    const status = error === 'source_content_requires_local_ai' ? 'forbidden' : 'error';
    return [status, undefined, [issue(error, `command ${command.name} 실행 실패: ${error}`)]];
  }

  private listSessionSources(
    command: AxCommand,
    sessionId: string | undefined,
  ): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const parsed = AxSessionSourceListArgsSchema.safeParse(command.args);
    if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
    if (!sessionId?.trim()) {
      return ['invalid', undefined, [issue('workspace_session_required', '현재 대화 세션이 필요합니다.')]];
    }
    if (!this.options.workspaceSources) {
      return ['error', undefined, [issue('session_source_unavailable', '세션 자료 저장소를 사용할 수 없습니다.')]];
    }
    return ['ok', { sessionId: sessionId.trim(), sources: this.options.workspaceSources.list(sessionId) }];
  }

  private readSessionSource(
    command: AxCommand,
    sessionId: string | undefined,
  ): [AxCommandResult['status'], unknown, AxCommandIssue[]?] {
    const parsed = AxSessionSourceReadArgsSchema.safeParse(command.args);
    if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
    if (!sessionId?.trim()) {
      return ['invalid', undefined, [issue('workspace_session_required', '현재 대화 세션이 필요합니다.')]];
    }
    if (!this.options.workspaceSources) {
      return ['error', undefined, [issue('session_source_unavailable', '세션 자료 저장소를 사용할 수 없습니다.')]];
    }
    try {
      return ['ok', this.options.workspaceSources.read(sessionId, parsed.data.sourceId, parsed.data.maxChars)];
    } catch (error) {
      const code = error instanceof WorkspaceSourceError ? error.code : 'session_source_read_failed';
      const status: AxCommandResult['status'] = code.endsWith('not_found') ? 'not_found' : 'error';
      return [status, undefined, [issue(code, '현재 대화 세션 자료를 읽을 수 없습니다.')]];
    }
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

}

export function isAxCommandName(value: string): value is AxCommandName {
  return COMMAND_NAME_SET.has(value);
}
