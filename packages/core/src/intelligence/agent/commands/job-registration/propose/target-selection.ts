import {
  httpEndpointsFromConnections,
  type HttpEndpoint,
} from '../../../../../connectors/http/connection.js';
import type { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import {
  connectedIds,
  actionInputScope,
  httpConnectionInput,
  needsSlackChannelSelection,
  pickHttpEndpoint,
  slackChannelInput,
} from '../targets.js';
import type { JobProposeReadResult, ListSlackChannels } from '../contract.js';
import { targetSelectionPresentation } from '../presentation.js';
import { issue } from '../shared.js';
import type { ProposeResponse, ValidatedProposeInput } from './contracts.js';
import { parseLocalFolderConnectionConfig } from '../../../../../platform/local-folder-config.js';
import type { AxInputRequest, AxInputRequestOption } from '../../schema.js';

function gmailAccountInput(account?: string): AxInputRequest {
  return {
    id: 'job-trigger-gmail-account',
    label: 'Gmail 계정',
    type: 'email',
    target: 'trigger',
    parameterName: 'accountId',
    required: true,
    reason: account
      ? '연결된 Gmail 계정을 선택해 주세요.'
      : '새 메일을 감지할 Gmail 계정을 입력해 주세요.',
    ...(account ? { options: [{ value: account, label: account }] } : {}),
  };
}

function localFolderInput(folders: readonly { id: string; label: string; path: string }[]): AxInputRequest {
  const options: AxInputRequestOption[] = folders.flatMap((folder) => {
    if (!folder.id.trim() || folder.id !== folder.id.trim() || folder.id.length > 256) return [];
    return [{
      value: folder.id,
      label: (folder.label.trim() || folder.path.trim() || folder.id).slice(0, 160),
      description: folder.path.slice(0, 240),
    }];
  });
  return {
    id: 'job-trigger-local-folder',
    label: '감시할 폴더',
    type: 'folder',
    target: 'trigger',
    parameterName: 'folderId',
    required: true,
    reason: '새 파일을 감지할 연결 폴더를 선택해 주세요.',
    options,
  };
}

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

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function cachedSlackChannelLister(listSlackChannels?: ListSlackChannels): ListSlackChannels | undefined {
  if (!listSlackChannels) return undefined;
  let pending: Promise<JobProposeReadResult> | undefined;
  return () => {
    pending ??= Promise.resolve()
      .then(() => listSlackChannels())
      .catch(() => ({ ok: false, error: 'slack_channel_list_unavailable' }));
    return pending;
  };
}

function slackChannelExists(result: JobProposeReadResult, target: string): boolean | undefined {
  if (!result.ok) return undefined;
  const envelope = asRecord(result.data);
  const payload = asRecord(envelope?.data) ?? envelope;
  const channels = Array.isArray(payload?.channels) ? payload.channels : undefined;
  if (!channels) return undefined;
  const normalizedTarget = target.trim().replace(/^#/u, '');
  return channels.some((entry) => {
    const channel = asRecord(entry);
    const id = typeof channel?.id === 'string' ? channel.id.trim() : '';
    const name = typeof channel?.name === 'string' ? channel.name.trim() : '';
    return normalizedTarget === id || normalizedTarget === name;
  });
}

async function slackTargetState(
  listSlackChannels: ListSlackChannels | undefined,
  target: string,
): Promise<'valid' | 'invalid' | 'unverified'> {
  if (!listSlackChannels) return 'unverified';
  const exists = slackChannelExists(await listSlackChannels(), target);
  return exists === undefined ? 'unverified' : exists ? 'valid' : 'invalid';
}

/** Fill an unambiguous connected trigger target; never invents an id when there are choices. */
export async function resolveGenericJobTargets(options: {
  store: WorkflowStore;
  input: ValidatedProposeInput;
  listSlackChannels?: ListSlackChannels;
}): Promise<GenericJobTargetSelectionResult> {
  const trigger = options.input.data.trigger;
  const listSlackChannels = cachedSlackChannelLister(options.listSlackChannels);
  const connected = connectedIds(options.store);
  let resolved = trigger;
  if (trigger?.type === 'gmail.new_message') {
    const connection = options.store.getConnections().find((entry) => entry.connector === 'gmail' && entry.connected);
    if (!connected.includes('gmail')) {
      return {
        ok: false,
        response: ['invalid', undefined, [issue(
          'gmail_connection_required',
          'Gmail 새 메일 트리거를 사용하려면 Gmail 연결이 필요합니다.',
          'args.trigger.accountId',
        )]],
      };
    }
    const accountId = configuredGmailAccount(connection?.config);
    if (!trigger.accountId.trim() && accountId) {
      resolved = { ...trigger, accountId };
    } else if (!trigger.accountId.trim()) {
      const request = gmailAccountInput();
      return {
        ok: false,
        response: ['needs_input', { message: 'Gmail 새 메일 트리거에 사용할 계정을 입력해 주세요.' }, [issue(
          'job_trigger_target_required',
          'Gmail 새 메일 트리거에 accountId가 필요합니다.',
          'args.trigger.accountId',
          [request],
        )]],
      };
    }
    if (trigger.accountId.trim() && accountId && trigger.accountId.trim() !== accountId) {
      const request = gmailAccountInput(accountId);
      return {
        ok: false,
        response: ['needs_input', { message: 'Gmail 새 메일 트리거의 accountId가 연결된 계정과 일치하지 않습니다.' }, [issue(
          'job_trigger_target_invalid',
          'Gmail 새 메일 트리거에 연결된 계정의 accountId를 사용해 주세요.',
          'args.trigger.accountId',
          [request],
        )]],
      };
    }
  }
  if (trigger?.type === 'slack.new_message') {
    if (!connected.includes('slack')) {
      return {
        ok: false,
        response: ['invalid', undefined, [issue(
          'slack_connection_required',
          'Slack 새 메시지 트리거를 사용하려면 Slack 연결이 필요합니다.',
          'args.trigger.channel',
        )]],
      };
    }
    if (!trigger.channel.trim()) {
      const request = await slackChannelInput(listSlackChannels, 'job-trigger-slack-channel', {
        target: 'trigger', parameterName: 'channel',
      });
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
    if (await slackTargetState(listSlackChannels, trigger.channel) === 'invalid') {
      const request = await slackChannelInput(listSlackChannels, 'job-trigger-slack-channel', {
        target: 'trigger', parameterName: 'channel',
      });
      return {
        ok: false,
        response: ['needs_input', { message: 'Slack 새 메시지 트리거에 존재하는 채널을 선택해 주세요.' }, [issue(
          'job_trigger_target_invalid',
          'Slack 새 메시지 트리거의 channel을 연결된 채널로 선택해 주세요.',
          'args.trigger.channel',
          [request],
        )]],
      };
    }
  }
  if (trigger?.type === 'local_folder.new_file') {
    const connection = options.store.getConnections().find((entry) => entry.connector === 'local_folder' && entry.connected);
    const folders = (parseLocalFolderConnectionConfig(connection?.config)?.folders ?? [])
      .filter((folder) => folder.id.trim().length > 0
        && folder.id === folder.id.trim()
        && folder.id.length <= 256);
    if (!connected.includes('local_folder')) {
      return {
        ok: false,
        response: ['invalid', undefined, [issue(
          'local_folder_connection_required',
          '새 파일 트리거를 사용하려면 연결 폴더가 필요합니다.',
          'args.trigger.folderId',
        )]],
      };
    }
    if (!trigger.folderId.trim() && folders.length === 1) {
      resolved = { ...trigger, folderId: folders[0]!.id, folderPath: folders[0]!.path };
    } else if (!trigger.folderId.trim()) {
      if (folders.length === 0) {
        return {
          ok: false,
          response: ['invalid', undefined, [issue(
            'local_folder_selection_unavailable',
            '연결된 폴더가 없습니다. 설정에서 감시할 폴더를 먼저 연결해 주세요.',
            'args.trigger.folderId',
          )]],
        };
      }
      const request = localFolderInput(folders);
      return {
        ok: false,
        response: ['needs_input', { message: '새 파일 트리거에 사용할 연결 폴더를 입력해 주세요.' }, [issue(
          'job_trigger_target_required',
          '폴더 새 파일 트리거에 folderId가 필요합니다.',
          'args.trigger.folderId',
          [request],
        )]],
      };
    } else if (folders.length === 0 || !folders.some((folder) => folder.id === trigger.folderId.trim())) {
      if (folders.length === 0) {
        return {
          ok: false,
          response: ['invalid', undefined, [issue(
            'local_folder_selection_unavailable',
            '연결된 폴더가 없습니다. 설정에서 감시할 폴더를 먼저 연결해 주세요.',
            'args.trigger.folderId',
          )]],
        };
      }
      const request = localFolderInput(folders);
      return {
        ok: false,
        response: ['needs_input', { message: '새 파일 트리거에 존재하는 연결 폴더를 선택해 주세요.' }, [issue(
          'job_trigger_target_invalid',
          '폴더 새 파일 트리거의 folderId를 연결된 폴더로 선택해 주세요.',
          'args.trigger.folderId',
          [request],
        )]],
      };
    }
  }

  for (const step of options.input.data.steps ?? []) {
    if (step.type !== 'action' || step.connector !== 'slack') continue;
    const scope = actionInputScope(step, 'channel');
    if (!scope) continue;
    const channel = typeof step.params.channel === 'string' ? step.params.channel.trim() : '';
    if (channel && await slackTargetState(listSlackChannels, channel) === 'invalid') {
      const request = await slackChannelInput(
        listSlackChannels,
        `job-action-${step.id}-slack-channel`,
        scope,
      );
      return {
        ok: false,
        response: ['needs_input', {
          message: 'Slack 메시지를 보낼 존재하는 채널을 선택해 주세요.',
          presentation: targetSelectionPresentation([request], {
            actionLabel: '채널을 선택하고 업무 초안 검토',
            actionValue: '선택한 Slack 채널로 업무 초안을 검토해줘',
            note: '채널을 선택하면 업무 초안을 먼저 보여드립니다. 실제 외부 발송은 별도 승인 전까지 실행하지 않습니다.',
          }),
        }, [issue(
          'job_action_target_invalid',
          'Slack 메시지 단계의 channel을 연결된 채널로 선택해 주세요.',
          'args.steps',
          [request],
        )]],
      };
    }
  }

  const missingSlackActionTarget = options.input.data.steps?.find(
    (step) => step.type === 'action' && needsSlackChannelSelection(step),
  );
  if (missingSlackActionTarget?.type === 'action') {
    const scope = actionInputScope(missingSlackActionTarget, 'channel');
    if (!scope) {
      return {
        ok: false,
        response: ['invalid', undefined, [issue(
          'job_action_input_scope_unavailable',
          'Slack 채널 입력을 업무 단계에 연결할 수 없습니다.',
          `args.steps.${missingSlackActionTarget.id}`,
        )]],
      };
    }
    const request = await slackChannelInput(
      listSlackChannels,
      `job-action-${missingSlackActionTarget.id}-slack-channel`,
      scope,
    );
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
    if (needsHttpSelection) targetInputs.push(httpConnectionInput(endpoints, 'job-http-connection', {
      target: 'job', parameterName: 'fetch.connectionId',
    }));
    if (!input.channel) targetInputs.push(await slackChannelInput(options.listSlackChannels, 'job-slack-channel', {
      target: 'job', parameterName: 'notify.channel',
    }));

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
          targetInputs,
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
