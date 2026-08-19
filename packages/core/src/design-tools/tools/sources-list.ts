import { getConnectorLabel } from '../../catalog/connectors.js';
import { listModuleSourceHandlers } from '../../modules/packages/register.js';
import type { DesignToolContext, DesignToolHandler } from '../types.js';

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const SOURCE_HANDLERS = listModuleSourceHandlers();

export const sourcesList: DesignToolHandler = (ctx, args) => {
  const connector = stringArg(args, 'connector');
  if (connector) {
    const handler = SOURCE_HANDLERS[connector];
    if (!handler) {
      return {
        connector,
        connected: ctx.connectedConnectorIds.includes(connector),
        sources: [],
        note: `${getConnectorLabel(connector)}는 sources.list 대상이 아닙니다.`,
      };
    }
    return handler(ctx);
  }

  return {
    sources: Object.keys(SOURCE_HANDLERS).map((id) => SOURCE_HANDLERS[id]!(ctx)),
  };
};
