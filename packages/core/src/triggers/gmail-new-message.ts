import type { TriggerHandler, TriggerPollResult } from './types.js';

export const gmailNewMessageHandler: TriggerHandler<{ type: 'gmail.new_message'; accountId: string }> = {
  type: 'gmail.new_message',
  connector: 'gmail',

  async poll(ctx) {
    const gmail = ctx.connectors.gmail;
    if (!gmail) {
      return { events: [], cursor: ctx.cursor };
    }

    const result = await gmail.execute(
      'new_message.poll',
      {
        initialized: ctx.cursor.initialized ?? false,
        seenMessageIds: ctx.cursor.seenMessageIds ?? [],
        historyId: ctx.cursor.historyId,
      },
      {
        executionId: `trigger-poll:${ctx.skillId}`,
        skillId: ctx.skillId,
        variables: {},
        log: () => {},
      },
    );

    if (!result.ok) {
      throw new Error(result.error ?? 'gmail trigger poll failed');
    }

    const data = result.data as {
      events?: Array<{ type: string; payload: Record<string, unknown> }>;
      cursor: TriggerPollResult['cursor'];
    };
    const events = (data.events ?? []).map((event) => ({
      type: event.type,
      payload: event.payload,
    }));

    return { events, cursor: data.cursor ?? ctx.cursor };
  },
};
