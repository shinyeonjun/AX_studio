import { z } from 'zod';
import {
  httpEndpointsFromConnections,
  matchHttpEndpoint,
  type HttpEndpoint,
} from '../../modules/http/connection.js';
import { resolveHttpRequestUrl } from '../../modules/http/url-security.js';
import { actionRefFor } from '../../workflow/action-definition.js';
import { validateWorkflowContracts, type ContractValidationIssue } from '../../workflow/contract-validator.js';
import { isValidCronExpression, isValidTimeZone } from '../../workflow/cron.js';
import {
  parseWorkflowIR,
  validateWorkflowIR,
  type WorkflowIR,
} from '../../workflow/schema.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import type {
  AxCommandIssue,
  AxCommandResult,
  AxInputRequest,
  AxInputRequestOption,
  AxUiPresentation,
} from './schema.js';

export const JOB_COMMIT_CONFIRM_VALUE = '이 업무를 저장하고 스케줄을 켜줘';
export const DEFAULT_JOB_CRON = '0 21 * * *';
export const DEFAULT_JOB_TIMEZONE = 'Asia/Seoul';

/** Models often emit compact strings instead of the nested objects in the command contract. */
export function coerceJobProposeArgs(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = { ...(value as Record<string, unknown>) };
  const asFilledString = (input: unknown): string | undefined =>
    typeof input === 'string' && input.trim() ? input : undefined;
  const asBoolean = (input: unknown): unknown =>
    input === 'true' ? true : input === 'false' ? false : input;

  if (typeof record.interpret === 'string') record.interpret = { goal: record.interpret };
  if (typeof record.notify === 'string') record.notify = { channel: record.notify };
  if (typeof record.fetch === 'string') record.fetch = { path: record.fetch };
  if (typeof record.schedule === 'string') {
    const fields = record.schedule.trim().split(/\s+/);
    record.schedule = fields.length >= 6
      ? { cron: fields.slice(0, 5).join(' '), timezone: fields.slice(5).join(' ') }
      : { cron: record.schedule };
  }

  // Lift the top-level aliases models emit when they answer a needs_input turn.
  const topPath = asFilledString(record.httpPath) ?? asFilledString(record.path);
  const topConnection = asFilledString(record.connectionId) ?? asFilledString(record.connection_id);
  if (topPath || topConnection) {
    const fetch = record.fetch && typeof record.fetch === 'object' && !Array.isArray(record.fetch)
      ? { ...(record.fetch as Record<string, unknown>) }
      : {};
    if (topPath && fetch.path == null) fetch.path = topPath;
    if (topConnection && fetch.connectionId == null) fetch.connectionId = topConnection;
    record.fetch = fetch;
  }
  const topChannel = asFilledString(record.channel);
  if (topChannel) {
    const notify = record.notify && typeof record.notify === 'object' && !Array.isArray(record.notify)
      ? { ...(record.notify as Record<string, unknown>) }
      : {};
    if (notify.channel == null) notify.channel = topChannel;
    record.notify = notify;
  }

  if (record.fetch && typeof record.fetch === 'object' && !Array.isArray(record.fetch)) {
    const fetch = { ...(record.fetch as Record<string, unknown>) };
    if (typeof fetch.method === 'string') fetch.method = fetch.method.trim().toUpperCase();
    if (fetch.connectionId == null && typeof fetch.connection_id === 'string') {
      fetch.connectionId = fetch.connection_id;
    }
    record.fetch = fetch;
  }
  if (record.notify && typeof record.notify === 'object' && !Array.isArray(record.notify)) {
    const notify = { ...(record.notify as Record<string, unknown>) };
    notify.skipIfEmpty = asBoolean(notify.skipIfEmpty);
    record.notify = notify;
  }
  record.runOnceNow = asBoolean(record.runOnceNow);
  record.allowExternalAuto = asBoolean(record.allowExternalAuto);
  return record;
}

export const AxJobProposeArgsSchema = z.object({
  name: z.string().trim().min(1).max(120),
  goal: z.string().trim().min(1).max(2_000),
  schedule: z.object({
    cron: z.string().trim().min(1).max(80).optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
  }).optional(),
  fetch: z.object({
    method: z.enum(['GET']).default('GET'),
    path: z.string().trim().min(1).max(2_000).optional(),
    connectionId: z.string().trim().min(1).max(80).optional(),
    headers: z.record(z.string().max(500)).optional(),
  }).optional(),
  interpret: z.object({
    goal: z.string().trim().min(1).max(4_000).optional(),
  }).optional(),
  notify: z.object({
    connector: z.literal('slack').default('slack'),
    channel: z.string().trim().min(1).max(200).optional(),
    skipIfEmpty: z.boolean().default(true),
  }).optional(),
  runOnceNow: z.boolean().default(true),
  allowExternalAuto: z.boolean().default(true),
});

export const AxJobCommitArgsSchema = z.object({});

export type AxJobProposeArgs = z.infer<typeof AxJobProposeArgsSchema>;

export interface NormalizedJobSpec {
  name: string;
  goal: string;
  cron: string;
  timezone: string;
  path: string;
  connectionId: string;
  httpLabel?: string;
  headers?: Record<string, string>;
  interpretGoal: string;
  channel: string;
  skipIfEmpty: boolean;
  runOnceNow: boolean;
  allowExternalAuto: boolean;
}

export interface PendingJobDraft {
  spec: NormalizedJobSpec;
  ir: WorkflowIR;
}

export interface JobProposeReadResult {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export type ListSlackChannels = () => Promise<JobProposeReadResult>;

function issue(code: string, message: string, path?: string, inputRequests?: AxInputRequest[]): AxCommandIssue {
  return {
    code,
    message,
    ...(path ? { path } : {}),
    ...(inputRequests?.length ? { inputRequests } : {}),
  };
}

function connectedIds(store: WorkflowStore): string[] {
  return store.getConnections().filter((entry) => entry.connected).map((entry) => entry.connector);
}

function pickHttpEndpoint(
  endpoints: readonly HttpEndpoint[],
  path: string,
  connectionId?: string,
): { ok: true; endpoint: HttpEndpoint } | { ok: false; code: 'missing' | 'not_found' | 'ambiguous' | 'invalid_path' } {
  if (endpoints.length === 0) return { ok: false, code: 'missing' };
  const named = connectionId?.trim() ? matchHttpEndpoint(endpoints, connectionId) : undefined;
  if (connectionId?.trim()) {
    if (!named) return { ok: false, code: 'not_found' };
    return resolveHttpRequestUrl(named.baseUrl, path).ok
      ? { ok: true, endpoint: named }
      : { ok: false, code: 'invalid_path' };
  }
  if (endpoints.length === 1) {
    return resolveHttpRequestUrl(endpoints[0]!.baseUrl, path).ok
      ? { ok: true, endpoint: endpoints[0]! }
      : { ok: false, code: 'invalid_path' };
  }
  return { ok: false, code: 'ambiguous' };
}

export function httpConnectionInput(
  endpoints: readonly HttpEndpoint[],
  id = 'job-http-connection',
): AxInputRequest {
  return {
    id,
    label: 'HTTP 연결',
    type: 'text',
    required: true,
    reason: '조회에 사용할 HTTP 연결을 선택해 주세요.',
    options: endpoints.map((endpoint): AxInputRequestOption => ({
      value: endpoint.id,
      label: endpoint.label || endpoint.id,
    })),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function slackChannelOptions(value: unknown): AxInputRequestOption[] {
  const envelope = asRecord(value);
  const payload = asRecord(envelope?.data) ?? envelope;
  const channels = Array.isArray(payload?.channels) ? payload.channels : [];
  const seen = new Set<string>();

  return channels.flatMap((entry): AxInputRequestOption[] => {
    const channel = asRecord(entry);
    const id = typeof channel?.id === 'string' ? channel.id.trim() : '';
    if (!id || seen.has(id)) return [];
    seen.add(id);
    const name = typeof channel?.name === 'string' ? channel.name.trim() : '';
    const label = name ? `${channel?.isPrivate === true ? '비공개 · ' : ''}#${name}` : id;
    const memberCount = typeof channel?.numMembers === 'number' && Number.isFinite(channel.numMembers)
      ? `${channel.numMembers}명 참여`
      : undefined;
    return [{ value: id, label, ...(memberCount ? { description: memberCount } : {}) }];
  });
}

export async function slackChannelInput(
  listSlackChannels?: ListSlackChannels,
  id = 'job-slack-channel',
): Promise<AxInputRequest> {
  const fallback: AxInputRequest = {
    id,
    label: 'Slack 채널',
    type: 'slack_channel',
    required: true,
    placeholder: '#채널명 또는 채널 ID',
    reason: listSlackChannels
      ? 'Slack 채널 목록을 불러오지 못했습니다. 채널 이름 또는 ID를 입력해 주세요.'
      : '공유할 Slack 채널 이름 또는 ID를 입력해 주세요.',
  };
  if (!listSlackChannels) return fallback;

  try {
    const result = await listSlackChannels();
    if (!result.ok) return fallback;
    const options = slackChannelOptions(result.data);
    if (options.length === 0) return fallback;
    return {
      ...fallback,
      placeholder: 'Slack 채널을 선택해 주세요',
      reason: '공유할 Slack 채널을 선택해 주세요.',
      options,
    };
  } catch {
    return fallback;
  }
}

export function targetSelectionPresentation(
  inputs: AxInputRequest[],
  options: {
    actionId?: string;
    actionLabel?: string;
    actionValue?: string;
    note?: string;
  } = {},
): AxUiPresentation {
  return {
    title: '공유 대상 선택',
    subtitle: '조회와 공유에 사용할 대상을 한 번에 선택해 주세요.',
    inputMode: 'batch',
    blocks: [{
      type: 'note',
      text: options.note ?? '선택 후 조회·요약한 공유안을 먼저 보여드립니다. 실제 외부 발송은 별도 승인 전까지 실행하지 않습니다.',
    }],
    inputs,
    actions: [{
      id: options.actionId ?? 'review_job_targets',
      label: options.actionLabel ?? '선택하고 공유안 검토',
      value: options.actionValue ?? '선택한 연결과 채널로 공유안을 검토해줘',
      tone: 'primary',
      purpose: 'reply',
    }],
  };
}

export function compileScheduledHttpSlackJob(spec: NormalizedJobSpec): WorkflowIR {
  const fetchParams: Record<string, unknown> = {
    method: 'GET',
    path: spec.path,
    connectionId: spec.connectionId,
  };
  if (spec.headers && Object.keys(spec.headers).length > 0) {
    fetchParams.headers = spec.headers;
  }

  const steps: WorkflowIR['steps'] = [
    {
      type: 'action',
      id: 'fetch',
      connector: 'http',
      action: 'request',
      actionRef: actionRefFor('http', 'request'),
      params: fetchParams,
      sideEffect: 'NONE',
    },
    {
      type: 'ai_decision',
      id: 'brief',
      goal: spec.interpretGoal,
      investigation: false,
      maxReads: 1,
      inputContracts: { response: 'TextArtifact' },
      bindings: { response: { from: 'fetch', output: 'response' } },
      outputSchema: {
        type: 'object',
        properties: {
          notify: { type: 'boolean' },
          summary: { type: 'string' },
        },
        required: ['notify', 'summary'],
      },
    },
    {
      type: 'action',
      id: 'notify',
      connector: 'slack',
      action: 'message.send',
      actionRef: actionRefFor('slack', 'message.send'),
      params: { channel: spec.channel },
      bindings: { text: { from: 'brief', output: 'summary' } },
      sideEffect: 'EXTERNAL',
    },
  ];

  if (spec.skipIfEmpty) {
    steps.splice(2, 0, {
      type: 'if',
      id: 'should_notify',
      condition: { op: 'eq', left: { ref: 'brief.notify' }, right: { lit: true } },
      thenStepIds: ['notify'],
    });
  }

  return parseWorkflowIR({
    name: spec.name,
    goal: spec.goal,
    version: 1,
    trigger: { type: 'schedule', schedule: spec.cron, timezone: spec.timezone },
    inputs: [],
    steps,
    permissions: {},
    approval: [],
    allowExternalAuto: spec.allowExternalAuto,
    success: '스케줄된 HTTP 조회 결과를 요약해 Slack으로 전달',
    assumptions: [],
    sideEffects: { notify: 'EXTERNAL' },
    dataPolicy: {},
  });
}

function confirmationPresentation(spec: NormalizedJobSpec, httpLabel?: string): AxUiPresentation {
  const autoNote = spec.allowExternalAuto
    ? '확인하면 이후 스케줄 실행에서 Slack 발송을 매번 승인하지 않습니다.'
    : '확인해도 이후 Slack 발송은 실행마다 승인이 필요합니다.';
  const runNote = spec.runOnceNow ? '저장 직후 한 번 실행합니다.' : '지금은 실행하지 않고 스케줄만 켭니다.';
  return {
    title: '이 업무를 저장할까요?',
    subtitle: spec.name,
    inputMode: 'individual',
    blocks: [
      {
        type: 'steps',
        title: '등록 내용',
        items: [
          `스케줄: ${spec.cron} (${spec.timezone})`,
          `HTTP GET: ${spec.path}${httpLabel ? ` (${httpLabel})` : ''}`,
          `Slack: ${spec.channel}`,
          runNote,
        ],
      },
      { type: 'note', text: autoNote },
    ],
    inputs: [],
    actions: [
      {
        id: 'confirm_job',
        label: '저장하고 켜기',
        value: JOB_COMMIT_CONFIRM_VALUE,
        tone: 'primary',
        purpose: 'confirm_job',
      },
    ],
  };
}

function missingInput(
  inputRequests: AxInputRequest[],
  message: string,
  path: string,
): [AxCommandResult['status'], unknown, AxCommandIssue[]] {
  return [
    'needs_input',
    { message },
    [issue('missing_argument', message, path, inputRequests)],
  ];
}

function mapContractIssue(entry: ContractValidationIssue): AxCommandIssue {
  return {
    code: entry.code,
    ...(entry.stepId ? { path: `steps.${entry.stepId}` } : {}),
    message: entry.message,
    ...(entry.expected ? { expected: entry.expected } : {}),
    ...(entry.available ? { available: entry.available } : {}),
    ...(entry.missingInputs?.length
      ? {
          inputRequests: entry.missingInputs.map((input, index) => ({
            id: `ax-input-${entry.stepId ?? entry.code}-${input.name}-${index}`,
            label: input.label,
            type: input.inputType ?? 'text',
            required: true,
            ...(input.placeholder ? { placeholder: input.placeholder } : {}),
            reason: input.question,
          })),
        }
      : {}),
  };
}

export async function proposeJob(options: {
  store: WorkflowStore;
  pending: Map<string, PendingJobDraft>;
  workspaceSessionId?: string;
  args: unknown;
  listSlackChannels?: ListSlackChannels;
}): Promise<[AxCommandResult['status'], unknown, AxCommandIssue[]?]> {
  const parsed = AxJobProposeArgsSchema.safeParse(coerceJobProposeArgs(options.args));
  if (!parsed.success) {
    return [
      'invalid',
      { message: '업무 초안 형식이 올바르지 않습니다. 이름, 목표, HTTP 경로, Slack 채널을 다시 보내 주세요.' },
      [issue('invalid_arguments', '업무 초안 형식이 올바르지 않습니다.')],
    ];
  }

  const sessionId = options.workspaceSessionId?.trim();
  if (!sessionId) {
    return ['invalid', undefined, [issue('workspace_session_required', '이 업무를 등록하려면 현재 대화 세션이 필요합니다.')]];
  }

  const data = parsed.data;
  const path = data.fetch?.path?.trim() ?? '';
  const channel = data.notify?.channel?.trim() ?? '';
  if (!path) {
    return missingInput([{
      id: 'job-http-path',
      label: 'HTTP 조회 경로',
      type: 'text',
      required: true,
      placeholder: '/api/v1/…',
      reason: '연결한 HTTP의 상대 경로를 입력해 주세요.',
    }], 'HTTP 조회 경로가 필요합니다. 연결한 HTTP의 상대 경로를 보내 주세요.', 'args.fetch.path');
  }
  const cron = data.schedule?.cron?.trim() || DEFAULT_JOB_CRON;
  const timezone = data.schedule?.timezone?.trim() || DEFAULT_JOB_TIMEZONE;
  if (!isValidCronExpression(cron)) {
    return ['invalid', undefined, [issue('invalid_schedule', `cron 표현식이 올바르지 않습니다: ${cron}`, 'args.schedule.cron')]];
  }
  if (!isValidTimeZone(timezone)) {
    return ['invalid', undefined, [issue('invalid_schedule', `timezone이 올바르지 않습니다: ${timezone}`, 'args.schedule.timezone')]];
  }

  const connected = connectedIds(options.store);
  if (!connected.includes('http')) {
    return ['invalid', undefined, [issue('http_connection_required', 'HTTP 연결이 없습니다. 설정에서 HTTP를 연결한 뒤 다시 등록해 주세요.')]];
  }
  if (!connected.includes('slack')) {
    return ['invalid', undefined, [issue('slack_connection_required', 'Slack 연결이 없습니다. 설정에서 연결한 뒤 다시 등록해 주세요.')]];
  }

  const endpoints = httpEndpointsFromConnections(options.store.getConnections());
  const availableConnections = endpoints
    .map((entry) => (entry.label ? `${entry.label}(${entry.id})` : entry.id))
    .join(', ');
  const picked = pickHttpEndpoint(endpoints, path, data.fetch?.connectionId);
  if (!picked.ok && picked.code === 'missing') {
    return ['invalid', undefined, [issue('http_connection_required', 'HTTP 연결이 없습니다. 설정에서 HTTP를 연결한 뒤 다시 등록해 주세요.')]];
  }
  if (!picked.ok && picked.code === 'not_found') {
    return ['invalid', undefined, [issue(
      'http_connection_not_found',
      `이름이 일치하는 HTTP 연결이 없습니다. 사용 가능한 연결: ${availableConnections}`,
      'args.fetch.connectionId',
    )]];
  }

  const needsHttpSelection = !picked.ok && picked.code === 'ambiguous';
  if (!channel || needsHttpSelection) {
    const inputs: AxInputRequest[] = [];
    if (needsHttpSelection) inputs.push(httpConnectionInput(endpoints));
    if (!channel) inputs.push(await slackChannelInput(options.listSlackChannels));

    return [
      'needs_input',
      {
        message: 'HTTP 연결과 Slack 채널을 선택해 주세요. 선택하면 조회·요약한 공유안을 먼저 검토합니다.',
        presentation: targetSelectionPresentation(inputs),
      },
      [issue(
        'job_targets_required',
        '조회와 공유에 사용할 대상을 선택해 주세요.',
        needsHttpSelection ? 'args.fetch.connectionId' : 'args.notify.channel',
      )],
    ];
  }
  if (!picked.ok) {
    return ['invalid', undefined, [issue(
      'http_origin_rejected',
      'HTTP 경로는 저장한 연결 주소 안의 상대 경로여야 합니다.',
      'args.fetch.path',
    )]];
  }

  const spec: NormalizedJobSpec = {
    name: data.name,
    goal: data.goal,
    cron,
    timezone,
    path,
    connectionId: picked.endpoint.id,
    httpLabel: picked.endpoint.label || picked.endpoint.baseUrl,
    headers: data.fetch?.headers,
    interpretGoal: data.interpret?.goal?.trim() || data.goal,
    channel,
    skipIfEmpty: data.notify?.skipIfEmpty ?? true,
    runOnceNow: data.runOnceNow,
    allowExternalAuto: data.allowExternalAuto,
  };

  let ir: WorkflowIR;
  try {
    ir = compileScheduledHttpSlackJob(spec);
  } catch {
    return ['invalid', undefined, [issue('invalid_workflow_schema', '업무를 워크플로 형식으로 변환하지 못했습니다. 입력 값을 확인해 주세요.')]];
  }

  const schema = validateWorkflowIR(ir);
  if (!schema.ok) {
    return ['invalid', undefined, [issue('invalid_workflow_schema', '업무를 워크플로 형식으로 변환하지 못했습니다. 입력 값을 확인해 주세요.')]];
  }
  const contractIssues = validateWorkflowContracts(schema.value, { connectedConnectors: connected });
  if (contractIssues.length > 0) {
    return ['invalid', { saved: false }, contractIssues.map(mapContractIssue)];
  }

  options.pending.set(sessionId, { spec, ir });
  const presentation = confirmationPresentation(spec, spec.httpLabel);
  return ['ok', {
    saved: false,
    pending: true,
    presentation,
    message: `${spec.name} 초안을 확인한 뒤 저장할 수 있습니다.`,
    summary: {
      name: spec.name,
      schedule: spec.cron,
      timezone: spec.timezone,
      path: spec.path,
      connectionId: spec.connectionId,
      httpLabel: spec.httpLabel,
      channel: spec.channel,
      runOnceNow: spec.runOnceNow,
      allowExternalAuto: spec.allowExternalAuto,
    },
  }];
}

export async function commitJob(options: {
  store: WorkflowStore;
  pending: Map<string, PendingJobDraft>;
  workspaceSessionId?: string;
  allowJobCommit?: boolean;
  runWorkflow?: (workflowId: string) => Promise<unknown>;
}): Promise<[AxCommandResult['status'], unknown, AxCommandIssue[]?]> {
  if (!options.allowJobCommit) {
    return ['forbidden', undefined, [issue('job_commit_forbidden', '업무 저장은 확인 카드의 host 확인 이후에만 가능합니다.')]];
  }

  const sessionId = options.workspaceSessionId?.trim();
  if (!sessionId) {
    return ['invalid', undefined, [issue('workspace_session_required', '이 업무를 저장하려면 현재 대화 세션이 필요합니다.')]];
  }

  const draft = options.pending.get(sessionId);
  if (!draft) {
    return ['not_found', undefined, [issue('pending_job_not_found', '저장할 업무 초안이 없습니다. 먼저 업무를 다시 제안해 주세요.')]];
  }

  const connected = connectedIds(options.store);
  const contractIssues = validateWorkflowContracts(draft.ir, { connectedConnectors: connected });
  if (contractIssues.length > 0) {
    return ['invalid', { saved: false }, contractIssues.map((entry) => issue(entry.code, entry.message, entry.stepId))];
  }

  try {
    const saved = options.store.saveWorkflow(draft.ir);
    // Drop the draft as soon as the workflow exists so a failure in any later
    // step cannot leave a stale draft that would save a duplicate on retry.
    options.pending.delete(sessionId);
    options.store.setWorkflowActive(saved.workflowId, true);
    const chat = options.store.getWorkspaceChat(sessionId);
    if (chat) {
      options.store.saveWorkspaceChat({
        id: sessionId,
        messages: chat.messages,
        workflowId: saved.workflowId,
      });
    }

    let run: unknown;
    let runError: string | undefined;
    if (draft.spec.runOnceNow) {
      if (!options.runWorkflow) {
        runError = '지금 실행기는 연결되지 않았습니다. 스케줄은 켜져 있습니다.';
      } else {
        try {
          run = await options.runWorkflow(saved.workflowId);
        } catch (error) {
          runError = error instanceof Error ? error.message : String(error);
        }
      }
    }

    const message = runError
      ? `${draft.spec.name} 업무를 저장하고 스케줄을 켰습니다. 지금 실행은 실패했으니 실행 기록에서 원인을 확인해 주세요.`
      : draft.spec.runOnceNow
        ? `${draft.spec.name} 업무를 저장하고 스케줄을 켰습니다. 지금 한 번 실행을 시작했습니다.`
        : `${draft.spec.name} 업무를 저장하고 스케줄을 켰습니다.`;

    return ['ok', {
      operation: 'created',
      workflowId: saved.workflowId,
      version: saved.version,
      active: true,
      runOnceNow: draft.spec.runOnceNow,
      ...(run === undefined ? {} : { run }),
      ...(runError ? { runError } : {}),
      message,
    }];
  } catch (error) {
    const contract = (error as { issues?: Array<{ code: string; message: string; stepId?: string }> }).issues;
    if (Array.isArray(contract)) {
      return ['invalid', { saved: false }, contract.map((entry) => issue(entry.code, entry.message, entry.stepId))];
    }
    return ['error', undefined, [issue('workflow_persist_failed', error instanceof Error ? error.message : String(error))]];
  }
}
