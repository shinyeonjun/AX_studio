import type { AppState } from '../../types/app-state';

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
  const socketStatus = state?.slackSocketStatus;
  if (socketStatus === 'connecting' || socketStatus === 'reconnecting') {
    return {
      badge: '재연결 중',
      badgeClass: 'warning',
      headline: '메시지는 보낼 수 있지만 새 메시지 자동 감지를 다시 연결하고 있습니다.',
      detail: socketStatus === 'connecting' ? 'Slack 실시간 수신에 연결하는 중입니다.' : 'Slack 실시간 수신이 끊겨 자동으로 다시 연결하는 중입니다.',
      manualSend: true,
      realtimeTriggers: false,
    };
  }
  if (socketStatus === 'error') {
    return {
      badge: '실시간 연결 오류',
      badgeClass: 'warning',
      headline: '메시지는 보낼 수 있지만 새 메시지 자동 감지에 문제가 있습니다.',
      detail: state?.slackLastError ?? 'Slack 실시간 수신 연결에 문제가 있습니다. 실시간 수신 토큰을 확인해 주세요.',
      manualSend: true,
      realtimeTriggers: false,
    };
  }
  if (mode === 'socket') {
    return {
      badge: '실시간 연결됨',
      badgeClass: 'connected',
      headline: '메시지 보내기와 새 메시지 자동 감지를 모두 사용할 수 있습니다.',
      detail: '실시간 수신으로 새 Slack 메시지를 바로 받습니다.',
      manualSend: true,
      realtimeTriggers: true,
    };
  }
  if (mode === 'poll') {
    return {
      badge: '부분 연결됨',
      badgeClass: 'warning',
      headline: '메시지는 보낼 수 있지만 새 메시지 자동 감지는 꺼져 있습니다.',
      detail: state?.slackHasAppToken
        ? '실시간 수신 토큰은 저장됐지만 실시간 수신이 시작되지 않았습니다. 아래에서 다시 시도하세요.'
        : '봇 토큰만 연결됐습니다. 새 메시지 자동 감지에는 실시간 수신 토큰(xapp-)이 필요합니다.',
      manualSend: true,
      realtimeTriggers: false,
    };
  }
  return {
    badge: '미연결',
    badgeClass: '',
    headline: 'Slack을 연결하면 메시지 보내기와 새 메시지 자동 감지를 사용할 수 있습니다.',
    detail: state?.slackLastError ?? '봇 토큰과 실시간 수신 토큰이 필요합니다.',
    manualSend: false,
    realtimeTriggers: false,
  };
}
