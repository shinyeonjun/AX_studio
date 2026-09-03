import {
  httpEndpointsFromConnections,
  type HttpEndpoint,
} from '../../../../modules/http/connection.js';
import type { WorkflowStore } from '../../../../store/workflow-store.js';
import {
  connectedIds,
  httpConnectionInput,
  pickHttpEndpoint,
  slackChannelInput,
} from '../targets.js';
import type { ListSlackChannels } from '../contract.js';
import { targetSelectionPresentation } from '../presentation.js';
import { issue } from '../shared.js';
import type { ProposeResponse, ValidatedProposeInput } from './contracts.js';

export interface SelectedJobTargets {
  endpoint: HttpEndpoint;
  channel: string;
}

export type JobTargetSelectionResult =
  | { ok: true; value: SelectedJobTargets }
  | { ok: false; response: ProposeResponse };

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
