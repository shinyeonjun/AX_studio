import { isMessageToolField } from '../../contracts/tool-result.js';
import { ZodError } from 'zod';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { pollSlackNewMessages } from './new-message-poll/poll.js';
import { listSlackChannelPage, readSlackMessagePage, searchSlackMessagePage } from './read-page.js';
import { composeSlackMessagePayload } from './format-message/payload.js';
import { slackRequest } from './request.js';
import { messageToolDraft, type MessageToolDraft, type MessageSendBinding } from '../../contracts/tool-result.js';
import { resolveSlackChannelId } from './channel-resolve.js';

export class SlackConnector implements Connector {
  name = 'slack';

  constructor(private token: string) {}

  async prepareMessageSend(draft: MessageToolDraft): Promise<MessageSendBinding> {
    if (draft.tool !== 'slack' || !draft.channel.trim()) throw new Error('tool_result_destination_unknown');
    const { WebClient } = await import('@slack/web-api');
    const client = new WebClient(this.token, { timeout: 30_000, retryConfig: { retries: 0 }, rejectRateLimitedCalls: true });
    const auth = await client.auth.test();
    if (!auth.ok || !auth.team_id || !auth.user_id) throw new Error('tool_result_identity_unverified');
    const channelId = await resolveSlackChannelId(client, draft.channel.trim());
    if (!channelId) throw new Error('tool_result_destination_unknown');
    // Even an ID-shaped string must resolve through this authenticated workspace.
    const info = await client.conversations.info({ channel: channelId });
    if (!info.ok || info.channel?.id !== channelId || info.channel.is_archived) throw new Error('tool_result_destination_unknown');
    return { provider: 'slack', accountId: auth.user_id, accountLabel: auth.user || auth.user_id,
      workspaceId: auth.team_id, workspaceLabel: auth.team || auth.team_id,
      destinationId: channelId, destinationLabel: info.channel.name ? '#' + info.channel.name : channelId };
  }

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    if (action === 'message.send' && Object.keys(params).some(key => !isMessageToolField('slack', key))) {
      return { ok: false, error: 'Unsupported Slack thread/file/delivery fields', errorCode: 'unsupported_message_fields' };
    }
    try {
      ctx.abortSignal?.throwIfAborted();
      const { WebClient } = await import('@slack/web-api');
      const client = new WebClient(this.token, {
        timeout: 30_000,
        retryConfig: { retries: 0 },
        rejectRateLimitedCalls: true,
        requestInterceptor: (request) => {
          request.signal = ctx.abortSignal;
          return request;
        },
      });
      switch (action) {
        case 'message.send': {
          const channel = typeof params.channel === 'string' ? params.channel.trim() : '';
          if (!channel) {
            return { ok: false, error: 'channel_required', errorCode: 'invalid_params' };
          }
          const rawText = typeof params.text === 'string' ? params.text : '';
          if (!rawText.trim()) {
            return { ok: false, error: 'text_required', errorCode: 'invalid_params' };
          }
          if (!messageToolDraft('slack.message.send', params)) return { ok: false, error: 'invalid_message_payload', errorCode: 'invalid_params' };
          const payload = ctx.literalMessage ? { text: rawText } : composeSlackMessagePayload(rawText, ctx);
          const res = await slackRequest(() => client.chat.postMessage({
            channel,
            text: payload.text,
            ...(payload.blocks ? { blocks: payload.blocks } : {}),
          }));
          try { ctx.log({ at: new Date().toISOString(), level: 'info', message: 'slack.send', data: { channel: params.channel } }); }
          catch { /* The provider receipt remains authoritative when logging fails. */ }
          return { ok: true, data: res };
        }
        case 'new_message.poll': {
          const poll = await pollSlackNewMessages(client, {
            channel: String(params.channel ?? ''),
            initialized: Boolean(params.initialized),
            lastMessageTs: params.lastMessageTs as string | undefined,
            cursorChannel: params.cursorChannel as string | undefined,
            channelId: params.channelId as string | undefined,
          }, ctx.abortSignal);
          return { ok: true, data: poll };
        }
        case 'channels.list': {
          const page = await listSlackChannelPage(client, params, ctx.abortSignal);
          return { ok: true, data: page };
        }
        case 'messages.search': {
          const query = typeof params.query === 'string' ? params.query.trim() : '';
          if (!query) {
            return { ok: false, error: 'query_required', errorCode: 'invalid_params' };
          }
          const result = await searchSlackMessagePage(client, params, ctx.abortSignal);
          return { ok: true, data: result };
        }
        case 'messages.read': {
          const channel = typeof params.channel === 'string' ? params.channel.trim() : '';
          if (!channel) {
            return { ok: false, error: 'channel_required', errorCode: 'invalid_params' };
          }
          try {
            const result = await readSlackMessagePage(client, params, ctx.abortSignal);
            return { ok: true, data: result };
          } catch (err) {
            const message = err instanceof Error ? err.message : 'Slack request failed';
            if (message === 'channel_not_found') {
              return { ok: false, error: message, errorCode: 'channel_not_found' };
            }
            throw err;
          }
        }
        default:
          return { ok: false, error: `Unknown slack action: ${action}` };
      }
    } catch (err) {
      if (ctx.abortSignal?.aborted) return { ok: false, error: 'cancelled', errorCode: 'cancelled' };
      if (err instanceof ZodError) return { ok: false, error: 'invalid_read_params', errorCode: 'invalid_params' };
      const message = err instanceof Error ? err.message : 'Slack request failed';
      if (action === 'messages.search' && message.includes('not_allowed_token_type')) {
        return {
          ok: false,
          error: 'Slack 전체 메시지 검색에는 search:read 사용자 토큰이 필요합니다. 채널을 지정하면 messages.read를 사용할 수 있습니다.',
          errorCode: 'slack_search_scope_required',
          errorDetails: { requiredScope: 'search:read', alternativeAction: 'messages.read' },
        };
      }
      // Keep Slack's own reason (not_in_channel, invalid_auth, ratelimited …) as the code, so the
      // person is told what to do instead of a bare "Slack 작업에 실패".
      const platformCode = (err as { data?: { error?: unknown } } | null)?.data?.error;
      const code = typeof platformCode === 'string' && /^[a-z_]+$/u.test(platformCode)
        ? platformCode
        : /An API error occurred: ([a-z_]+)$/u.exec(message)?.[1];
      return { ok: false, error: code ?? message.slice(0, 1000), errorCode: code ?? 'slack_error' };
    }
  }
}
