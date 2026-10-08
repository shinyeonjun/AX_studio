import type { AppState } from '../../../../types/app-state';
import type { SettingsScreen } from '../../../../types/navigation';
import type { useAiDetection } from '../../hooks/ai-settings/useAiDetection';

export interface SettingsPageProps {
  detection: ReturnType<typeof useAiDetection>;
  screen: SettingsScreen;
  state: AppState | null;
  onScreenChange: (screen: SettingsScreen) => void;
  onRefresh: () => Promise<void>;
  onConnectSlack: (payload: { token: string; appToken?: string }) => Promise<void>;
  onDisconnectSlack: () => Promise<void>;
  onConnectGmail: () => Promise<void>;
  onDisconnectGmail: () => Promise<void>;
  onPickLocalFolder: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onAddLocalFolder: (payload: { path: string; label?: string }) => Promise<void>;
  onRemoveLocalFolder: (folderId: string) => Promise<void>;
  onConnectHttp: (payload: {
    endpointId?: string;
    baseUrl: string;
    label?: string;
    authType: 'none' | 'bearer' | 'apiKey' | 'basic';
    authHeader?: string;
    username?: string;
    token?: string;
    password?: string;
  }) => Promise<void>;
  onDisconnectHttp: (endpointId?: string) => Promise<void>;
  onConnectWebhook: (payload: {
    port: number;
    secret: string;
    label?: string;
    tunnelUrl?: string;
  }) => Promise<void>;
  onDisconnectWebhook: () => Promise<void>;
  onPickSqliteFile: () => Promise<{ ok: boolean; canceled?: boolean; path?: string }>;
  onDiscoverRdbTables: (payload: { databaseId?: string; type: 'mysql' | 'postgres' | 'sqlite'; filePath?: string; connectionString?: string }) => Promise<{ tables: string[]; truncated: boolean }>;
  onConnectRdb: (payload: {
    databaseId?: string;
    type: 'mysql' | 'postgres' | 'sqlite';
    connectionString?: string;
    filePath?: string;
    allowedSchemas?: string[];
    allowedTables?: string[];
    rowLimit?: number;
    label?: string;
  }) => Promise<{ databaseId?: string; label?: string; warning?: string } | void>;
  onDisconnectRdb: (databaseId?: string) => Promise<void>;
}
