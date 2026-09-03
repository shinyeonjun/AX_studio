export function persistedSlackMetadata(config: unknown): Record<string, unknown> {
  const record = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  return {
    ...(typeof record.team === 'string' ? { team: record.team } : {}),
    ...(typeof record.botUser === 'string' ? { botUser: record.botUser } : {}),
    ...(typeof record.connectedAt === 'string' ? { connectedAt: record.connectedAt } : {}),
    ...(record.tokenStored === true ? { tokenStored: true } : {}),
    ...(record.appTokenStored === true ? { appTokenStored: true } : {}),
  };
}
