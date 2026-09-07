import { getConnectorLabel } from '../../../catalog/connectors.js';
import { listModuleSourceHandlers } from '../../../connectors/packages/register.js';
import type { DesignToolHandler } from '../types.js';
import { metadataPage } from '../../../catalog/metadata-page.js';

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

const SOURCE_HANDLERS = listModuleSourceHandlers();

function pageSources(value: unknown, args: Record<string, unknown>) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const snapshot = value as Record<string, unknown>;
  if (!Array.isArray(snapshot.sources)) return snapshot;
  const { items, total, ...pagination } = metadataPage(snapshot.sources, args, source =>
    source && typeof source === 'object' ? [source.id, source.label]
      .filter((text): text is string => typeof text === 'string') : []);
  return { ...snapshot, sources: items, totalSources: total, ...pagination };
}

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
    return pageSources(handler(ctx), args);
  }

  return {
    sources: Object.keys(SOURCE_HANDLERS).map((id) => pageSources(SOURCE_HANDLERS[id]!(ctx), args)),
  };
};
