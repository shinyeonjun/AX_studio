export type ConnectorConnectionKind = 'oauth-loopback' | 'token' | 'config' | 'builtin';

export const CONNECTOR_IDS = [
  'gmail',
  'slack',
  'local_folder',
  'document',
  'rdb',
  'local_sheet',
  'transform',
] as const;

export type ConnectorId = (typeof CONNECTOR_IDS)[number];

export interface ConnectorCatalogEntry {
  id: ConnectorId;
  label: string;
  description: string;
  connectable: boolean;
  alwaysReal: boolean;
  /** Whether the current runtime has a non-mock implementation for this connector. */
  runtimeAvailable: boolean;
  connectionKind: ConnectorConnectionKind;
  emoji: string;
}
