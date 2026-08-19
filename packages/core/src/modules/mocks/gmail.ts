import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';

export interface MockGmailMessage {
  id: string;
  from: string;
  subject: string;
  body: string;
}

export class MockGmailConnector implements Connector {
  name = 'gmail';
  messages: MockGmailMessage[] = [];
  drafts: Array<{ id: string; to: string; body: string }> = [];
  sent: Array<{ to: string; body: string }> = [];

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    switch (action) {
      case 'messages.read':
      case 'message.read': {
        const id = params.messageId as string;
        const msg = this.messages.find((m) => m.id === id) ?? this.messages[0];
        ctx.log({ at: new Date().toISOString(), level: 'info', message: 'gmail.read', data: { id: msg?.id } });
        return { ok: true, data: msg };
      }
      case 'messages.search':
      case 'message.search': {
        const q = (params.query as string) ?? '';
        const results = this.messages.filter(
          (m) => m.subject.includes(q) || m.body.includes(q) || m.from.includes(q),
        );
        return { ok: true, data: results };
      }
      case 'draft.create': {
        const draft = {
          id: `draft-${Date.now()}`,
          to: (params.to as string) ?? '',
          body: (params.body as string) ?? '',
        };
        this.drafts.push(draft);
        ctx.variables.lastDraftId = draft.id;
        return { ok: true, data: draft };
      }
      case 'message.send': {
        const send = { to: (params.to as string) ?? '', body: (params.body as string) ?? '' };
        this.sent.push(send);
        return { ok: true, data: send };
      }
      case 'label.apply':
        return { ok: true, data: { label: params.label } };
      case 'new_message.poll': {
        const MAX_SEEN_MESSAGE_IDS = 500;
        const trimSeenIds = (ids: string[]) =>
          ids.length <= MAX_SEEN_MESSAGE_IDS ? ids : ids.slice(ids.length - MAX_SEEN_MESSAGE_IDS);

        const initialized = Boolean(params.initialized);
        const seenIds = new Set((params.seenMessageIds as string[]) ?? []);
        if (!initialized) {
          return {
            ok: true,
            data: {
              events: [],
              cursor: {
                initialized: true,
                seenMessageIds: trimSeenIds(this.messages.map((message) => message.id)),
              },
            },
          };
        }
        const newMessages = this.messages.filter((message) => !seenIds.has(message.id));
        const events = newMessages.map((message) => ({
          type: 'gmail.new_message' as const,
          payload: {
            messageId: message.id,
            from: message.from,
            subject: message.subject,
            snippet: message.body.slice(0, 200),
            sender: message.from,
          },
        }));
        const seenMessageIds = trimSeenIds([...seenIds, ...newMessages.map((message) => message.id)]);
        return {
          ok: true,
          data: {
            events,
            cursor: { initialized: true, seenMessageIds },
          },
        };
      }
      default:
        return { ok: false, error: `Unknown gmail action: ${action}` };
    }
  }
}
