import { authoritativeRequestClarification } from '../../../../../decision/request-anchor.js';
import type { JevChatRouterResult } from '../../routing/router.js';
import type { ChatReplies } from '../replies.js';
import { chatRequestContext, type CommandChatLoopContext } from '../turn-context.js';
import { commandRoute } from './command-route.js';
import { fallbackRoute, parameterizedRoute, previousResultRoute, replyRoute } from './routes.js';
import { prepareReadCatalog, routeFirstTurn, type JevRoute, type JevTurn } from './turn.js';

type JevRouteHandlers = {
  [K in JevChatRouterResult['kind']]: (turn: JevTurn, route: JevRoute<K>) => Promise<string>;
};

const JEV_ROUTE_HANDLERS: JevRouteHandlers = {
  request_rejected: async ({ context }, route) => {
    context.options.onRequestRejected?.(route.failure);
    return authoritativeRequestClarification(route.failure);
  },
  fallback: fallbackRoute,
  reply: replyRoute,
  previous_result: previousResultRoute,
  clarify: async (_turn, route) => route.message,
  parameterized: parameterizedRoute,
  command: commandRoute,
};

/** Route one ordinary chat turn through Jev and execute the selected bounded host command. */
export async function runJevChatTurn(context: CommandChatLoopContext, replies: ChatReplies): Promise<string> {
  const turn: JevTurn = {
    context,
    replies,
    catalog: prepareReadCatalog(context),
    requestContext: chatRequestContext(context.options),
  };
  const route = await routeFirstTurn(turn);
  const handler = JEV_ROUTE_HANDLERS[route.kind] as (turn: JevTurn, route: JevChatRouterResult) => Promise<string>;
  return handler(turn, route);
}
