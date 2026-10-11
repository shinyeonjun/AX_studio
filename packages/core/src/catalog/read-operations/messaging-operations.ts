import { addIndexedOperation, type IndexedReadOperation } from './indexed-operation.js';
import { explicitLimit, explicitSearchQuery, limitParameterHint } from './request-values.js';

export function addGmailOperations(operations: IndexedReadOperation[]): void {
  // A job started by a new mail reads that mail: the trigger's message is bound to this read.
  // Without it a "새 메일이 오면 요약" job searched and summarized the latest mails instead.
  addIndexedOperation(operations, {
    capabilityId: 'gmail.messages.read',
    connector: 'gmail',
    sourceLabel: 'Gmail',
    label: '새로 온 메일 본문 읽기',
    description: 'Gmail 새 메일로 시작하는 반복 업무에서, 그 업무를 시작한 메일의 본문 읽기 (메일 목록·검색이 아님)',
  }, () => ({ params: {}, parameterHints: [], requiresBinding: ['message'] }));
  addIndexedOperation(operations, {
    capabilityId: 'gmail.messages.search',
    connector: 'gmail',
    sourceLabel: 'Gmail',
    label: 'Gmail 메일 검색',
    description: 'Gmail의 메일 목록 또는 명시된 조건의 헤더 조회',
  }, (userMessage) => {
    const query = explicitSearchQuery(userMessage);
    const limit = explicitLimit(userMessage);
    const includeMetadata = /(?:보낸\s*사람|발신자|제목|날짜|헤더|metadata|subject|from|date)/iu.test(userMessage);
    return {
      params: {
        ...(query ? { query } : {}),
        ...(limit === undefined ? {} : { limit }),
        ...(includeMetadata ? { includeMetadata: true } : {}),
      },
      parameterHints: [limitParameterHint('limit', userMessage)],
    };
  });
}

/**
 * The channel a request names: "#ops" or "운영팀 채널". Only what the person wrote; a request
 * without one is asked for it, never given a guessed channel.
 */
export function explicitSlackChannel(message: string): string | undefined {
  const hashed = [...new Set([...message.matchAll(/(?:^|[\s(])#([\p{L}\p{N}_.-]{1,80})/gu)].map((match) => match[1]!))];
  // Two channels named: which one is meant is not the host's guess to make.
  if (hashed.length > 1) return undefined;
  if (hashed.length === 1) return `#${hashed[0]}`;
  const named = /([\p{L}\p{N}_.-]{1,80})\s*채널(?!\s*목록)/u.exec(message)?.[1];
  return named && !/^(?:slack|슬랙|이|그|저|어느|무슨|모든|전체|각)$/iu.test(named) ? `#${named}` : undefined;
}

export function addSlackOperations(operations: IndexedReadOperation[]): void {
  addIndexedOperation(operations, {
    capabilityId: 'slack.channels.list',
    connector: 'slack',
    sourceLabel: 'Slack',
    label: 'Slack 채널 목록',
    description: 'Slack 워크스페이스에서 볼 수 있는 채널 목록 조회',
  }, (userMessage) => {
    const limit = explicitLimit(userMessage);
    return { params: limit === undefined ? {} : { limit }, parameterHints: [] };
  });
  addIndexedOperation(operations, {
    capabilityId: 'slack.messages.read',
    connector: 'slack',
    sourceLabel: 'Slack',
    label: 'Slack 채널 최근 메시지',
    description: '지정한 Slack 채널의 최근 메시지 읽기',
  }, (userMessage) => {
    const channel = explicitSlackChannel(userMessage);
    const limit = explicitLimit(userMessage);
    return {
      params: {
        ...(channel ? { channel } : {}),
        ...(limit === undefined ? {} : { limit }),
      },
      parameterHints: [
        { path: 'channel', type: 'string', required: true },
        limitParameterHint('limit', userMessage),
      ],
      missingParameterPaths: channel ? [] : ['channel'],
    };
  });
  addIndexedOperation(operations, {
    capabilityId: 'slack.messages.search',
    connector: 'slack',
    sourceLabel: 'Slack',
    label: 'Slack 메시지 검색',
    description: 'Slack의 명시된 검색어에 해당하는 메시지 조회',
  }, (userMessage) => {
    const query = explicitSearchQuery(userMessage);
    const limit = explicitLimit(userMessage);
    return {
      params: {
        ...(query ? { query } : {}),
        ...(limit === undefined ? {} : { limit }),
      },
      parameterHints: [
        { path: 'query', type: 'string', required: true },
        limitParameterHint('limit', userMessage),
      ],
      missingParameterPaths: query ? [] : ['query'],
    };
  });
}
