export interface SlackSecret {
  token: string;
  appToken?: string;
}

export const SLACK_SECRET_READ_ERROR = '저장된 Slack 인증 정보를 읽을 수 없습니다. 다시 연결해 주세요.';
