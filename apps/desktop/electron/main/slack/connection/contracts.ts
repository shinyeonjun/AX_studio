export interface SlackSecret {
  token: string;
  appToken?: string;
}

export const SLACK_SECRET_READ_ERROR = '저장된 Slack 연결 정보를 읽을 수 없어요. 다시 연결해 주세요.';
