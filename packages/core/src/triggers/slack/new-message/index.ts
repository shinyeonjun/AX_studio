import type { TriggerHandler, TriggerPollResult } from '../../types.js';

/** Poll fallback when Socket Mode app token is not configured. */
export const slackNewMessageHandler: TriggerHandler<{ type: 'slack.new_message'; channel: string }> = {
  type: 'slack.new_message',
  connector: 'slack',
  transport: 'push',

  async poll(ctx) {
    const slack = ctx.connectors.slack;
    if (!slack) {
      throw new Error('slack_connector_missing');
    }

    const result = await slack.execute(
      'new_message.poll',
      {
        channel: ctx.trigger.channel,
        initialized: ctx.cursor.initialized ?? false,
        lastMessageTs: ctx.cursor.lastMessageTs,
        cursorChannel: ctx.cursor.channel,
        channelId: ctx.cursor.channelId,
      },
      {
        executionId: `trigger-poll:${ctx.workflowId}`,
        workflowId: ctx.workflowId,
        variables: {},
        log: () => {},
      },
    );

    if (!result.ok) {
      throw new Error(result.error ?? 'slack trigger poll failed');
    }

    const data = result.data as {
      events?: Array<{ type: string; payload: Record<string, unknown> }>;
      cursor: TriggerPollResult['cursor'];
    };

    return {
      events: (data.events ?? []).map((event) => ({
        type: event.type,
        payload: event.payload,
      })),
      cursor: data.cursor ?? ctx.cursor,
    };
  },
};
