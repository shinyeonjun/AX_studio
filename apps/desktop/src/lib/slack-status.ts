import type { AppState } from '../types/app-state';

export interface SlackCapabilityStatus {
  badge: string;
  badgeClass: string;
  headline: string;
  detail: string;
  manualSend: boolean;
  realtimeTriggers: boolean;
}

/** Split Slack connection into user-trustworthy capability states. */
export function slackCapabilityStatus(state: AppState | null): SlackCapabilityStatus {
  const mode = state?.slackConnectionMode ?? 'disconnected';
  if (mode === 'socket') {
    return {
      badge: '실시간 연결됨',
      badgeClass: 'connected',
      headline: '메시지 발송과 실시간 트리거가 모두 사용 가능합니다.',
      detail: 'Socket Mode로 새 Slack 메시지를 즉시 받습니다.',
      manualSend: true,
      realtimeTriggers: true,
    };
  }
  if (mode === 'poll') {
    return {
      badge: '부분 연결됨',
      badgeClass: 'warning',
      headline: '메시지 발송은 가능하지만 실시간 트리거는 꺼져 있습니다.',
      detail: state?.slackHasAppToken
        ? 'App Token은 저장됐지만 Socket Mode가 시작되지 않았습니다. 아래에서 다시 시도하세요.'
        : 'Bot Token만 연결됐습니다. 실시간 트리거에는 App Token(xapp-)이 필요합니다.',
      manualSend: true,
      realtimeTriggers: false,
    };
  }
  return {
    badge: '미연결',
    badgeClass: '',
    headline: 'Slack을 연결하면 알림 발송과 트리거를 사용할 수 있습니다.',
    detail: 'Bot Token과 Socket Mode용 App Token이 필요합니다.',
    manualSend: false,
    realtimeTriggers: false,
  };
}
