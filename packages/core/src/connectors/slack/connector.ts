import { WebClient } from '@slack/web-api';
import { ZodError } from 'zod';
import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { pollSlackNewMessages } from './new-message-poll.js';
import { listSlackChannelPage, readSlackMessagePage, searchSlackMessagePage } from './read-page.js';
import { composeSlackMessagePayload } from './format-message.js';
import { slackRequest } from './request.js';

export class SlackConnector implements Connector {
  name = 'slack';

  constructor(private token: string) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    try {
      ctx.abortSignal?.throwIfAborted();
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
          const payload = composeSlackMessagePayload(rawText, ctx);
          const res = await slackRequest(() => client.chat.postMessage({
            channel,
            text: payload.text,
            ...(payload.blocks ? { blocks: payload.blocks } : {}),
          }));
          ctx.log({ at: new Date().toISOString(), level: 'info', message: 'slack.send', data: { channel: params.channel } });
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
      return { ok: false, error: message.slice(0, 1000), errorCode: 'slack_error' };
    }
  }
}
