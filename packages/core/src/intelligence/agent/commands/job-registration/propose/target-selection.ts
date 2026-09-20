import {
  httpEndpointsFromConnections,
  type HttpEndpoint,
} from '../../../../../connectors/http/connection.js';
import type { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import {
  connectedIds,
  httpConnectionInput,
  needsSlackChannelSelection,
  pickHttpEndpoint,
  slackChannelInput,
} from '../targets.js';
import type { ListSlackChannels } from '../contract.js';
import { targetSelectionPresentation } from '../presentation.js';
import { issue } from '../shared.js';
import type { ProposeResponse, ValidatedProposeInput } from './contracts.js';
import { parseLocalFolderConnectionConfig } from '../../../../../platform/local-folder-config.js';

export interface SelectedJobTargets {
  endpoint: HttpEndpoint;
  channel: string;
}

export type GenericJobTargetSelectionResult =
  | { ok: true; input: ValidatedProposeInput }
  | { ok: false; response: ProposeResponse };

export type JobTargetSelectionResult =
  | { ok: true; value: SelectedJobTargets }
  | { ok: false; response: ProposeResponse };

function configuredGmailAccount(config: Record<string, unknown> | undefined): string | undefined {
  for (const value of [config?.account, config?.email, config?.id]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const credentialRef = config?.credentialRef;
  if (credentialRef && typeof credentialRef === 'object' && !Array.isArray(credentialRef)) {
    const connectionId = (credentialRef as Record<string, unknown>).connectionId;
    if (typeof connectionId === 'string' && connectionId.trim()) return connectionId.trim();
  }
  return undefined;
}

function actionChannel(input: ValidatedProposeInput): string | undefined {
  for (const step of input.data.steps ?? []) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) continue;
    const record = step as { connector?: unknown; params?: unknown };
    if (record.connector !== 'slack' || !record.params || typeof record.params !== 'object' || Array.isArray(record.params)) continue;
    const channel = (record.params as Record<string, unknown>).channel;
    if (typeof channel === 'string' && channel.trim()) return channel.trim();
  }
  return undefined;
}

/** Fill an unambiguous connected trigger target; never invents an id when there are choices. */
export async function resolveGenericJobTargets(options: {
  store: WorkflowStore;
  input: ValidatedProposeInput;
  listSlackChannels?: ListSlackChannels;
}): Promise<GenericJobTargetSelectionResult> {
  const trigger = options.input.data.trigger;
  let resolved = trigger;
  if (trigger?.type === 'gmail.new_message' && !trigger.accountId.trim()) {
    const connection = options.store.getConnections().find((entry) => entry.connector === 'gmail' && entry.connected);
    const accountId = configuredGmailAccount(connection?.config);
    if (!accountId) {
      return {
        ok: false,
        response: ['needs_input', { message: 'Gmail 새 메일 트리거에 사용할 계정을 입력해 주세요.' }, [issue(
          'job_trigger_target_required',
          'Gmail 새 메일 트리거에 accountId가 필요합니다.',
          'args.trigger.accountId',
        )]],
      };
    }
    resolved = { ...trigger, accountId };
  }
  if (trigger?.type === 'slack.new_message' && !trigger.channel.trim()) {
    const channel = actionChannel(options.input);
    if (channel) {
      resolved = { ...trigger, channel };
    } else {
      const request = await slackChannelInput(options.listSlackChannels, 'job-trigger-slack-channel');
      return {
        ok: false,
        response: ['needs_input', { message: 'Slack 새 메시지 트리거에 사용할 채널을 선택해 주세요.' }, [issue(
          'job_trigger_target_required',
          'Slack 새 메시지 트리거에 channel이 필요합니다.',
          'args.trigger.channel',
          [request],
        )]],
      };
    }
  }
  if (trigger?.type === 'local_folder.new_file' && !trigger.folderId.trim()) {
    const connection = options.store.getConnections().find((entry) => entry.connector === 'local_folder' && entry.connected);
    const folders = parseLocalFolderConnectionConfig(connection?.config)?.folders ?? [];
    if (folders.length === 1) {
      resolved = { ...trigger, folderId: folders[0]!.id, folderPath: folders[0]!.path };
    } else {
      return {
        ok: false,
        response: ['needs_input', { message: '새 파일 트리거에 사용할 연결 폴더를 입력해 주세요.' }, [issue(
          'job_trigger_target_required',
          '폴더 새 파일 트리거에 folderId가 필요합니다.',
          'args.trigger.folderId',
        )]],
      };
    }
  }

  const missingSlackActionTarget = options.input.data.steps?.some(
    (step) => step.type === 'action' && needsSlackChannelSelection(step),
  );
  if (missingSlackActionTarget) {
    const request = await slackChannelInput(options.listSlackChannels);
    return {
      ok: false,
      response: ['needs_input', {
        message: 'Slack 메시지를 보낼 채널을 선택해 주세요.',
        presentation: targetSelectionPresentation([request], {
          actionLabel: '채널을 선택하고 업무 초안 검토',
          actionValue: '선택한 Slack 채널로 업무 초안을 검토해줘',
          note: '채널을 선택하면 업무 초안을 먼저 보여드립니다. 실제 외부 발송은 별도 승인 전까지 실행하지 않습니다.',
        }),
      }, [issue(
        'job_action_target_required',
        'Slack 알림 단계에 channel이 필요합니다.',
        'args.steps',
        [request],
      )]],
    };
  }

  if (resolved === trigger) return { ok: true, input: options.input };
  return {
    ok: true,
    input: {
      ...options.input,
      data: { ...options.input.data, trigger: resolved },
    },
  };
}

export async function resolveJobTargets(options: {
  store: WorkflowStore;
  input: ValidatedProposeInput;
  listSlackChannels?: ListSlackChannels;
}): Promise<JobTargetSelectionResult> {
  const { store, input } = options;
  const connected = connectedIds(store);
  if (!connected.includes('http')) {
    return {
      ok: false,
      response: ['invalid', undefined, [issue('http_connection_required', 'HTTP 연결이 없습니다. 설정에서 HTTP를 연결한 뒤 다시 등록해 주세요.')]],
    };
  }
  if (!connected.includes('slack')) {
    return {
      ok: false,
      response: ['invalid', undefined, [issue('slack_connection_required', 'Slack 연결이 없습니다. 설정에서 연결한 뒤 다시 등록해 주세요.')]],
    };
  }

  const endpoints = httpEndpointsFromConnections(store.getConnections());
  const availableConnections = endpoints
    .map((entry) => (entry.label ? entry.label + '(' + entry.id + ')' : entry.id))
    .join(', ');
  const picked = pickHttpEndpoint(endpoints, input.path, input.data.fetch?.connectionId);
  if (!picked.ok && picked.code === 'missing') {
    return {
      ok: false,
      response: ['invalid', undefined, [issue('http_connection_required', 'HTTP 연결이 없습니다. 설정에서 HTTP를 연결한 뒤 다시 등록해 주세요.')]],
    };
  }
  if (!picked.ok && picked.code === 'not_found') {
    return {
      ok: false,
      response: ['invalid', undefined, [issue(
        'http_connection_not_found',
        '이름이 일치하는 HTTP 연결이 없습니다. 사용 가능한 연결: ' + availableConnections,
        'args.fetch.connectionId',
      )]],
    };
  }

  const needsHttpSelection = !picked.ok && picked.code === 'ambiguous';
  if (!input.channel || needsHttpSelection) {
    const targetInputs = [];
    if (needsHttpSelection) targetInputs.push(httpConnectionInput(endpoints));
    if (!input.channel) targetInputs.push(await slackChannelInput(options.listSlackChannels));

    return {
      ok: false,
      response: [
        'needs_input',
        {
          message: 'HTTP 연결과 Slack 채널을 선택해 주세요. 선택하면 조회·요약한 공유안을 먼저 검토합니다.',
          presentation: targetSelectionPresentation(targetInputs),
        },
        [issue(
          'job_targets_required',
          '조회와 공유에 사용할 대상을 선택해 주세요.',
          needsHttpSelection ? 'args.fetch.connectionId' : 'args.notify.channel',
        )],
      ],
    };
  }
  if (!picked.ok) {
    return {
      ok: false,
      response: ['invalid', undefined, [issue(
        'http_origin_rejected',
        'HTTP 경로는 저장한 연결 주소 안의 상대 경로여야 합니다.',
        'args.fetch.path',
      )]],
    };
  }

  return { ok: true, value: { endpoint: picked.endpoint, channel: input.channel } };
}
