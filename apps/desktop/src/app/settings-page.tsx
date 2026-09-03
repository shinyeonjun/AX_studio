import type { AppState } from '../types/app-state';
import type { SettingsScreen } from '../types/navigation';
import { SettingsPage } from '../components/settings/SettingsPage';

interface AppSettingsPageProps {
  screen: SettingsScreen;
  state: AppState;
  onScreenChange: (screen: SettingsScreen) => void;
  onRefresh: () => Promise<void>;
}

export function AppSettingsPage({ screen, state, onScreenChange, onRefresh }: AppSettingsPageProps) {
  return (
    <SettingsPage
      screen={screen}
      onScreenChange={onScreenChange}
      state={state}
      onRefresh={onRefresh}
      onConnectSlack={async (payload) => {
        await window.ax.connectSlack(payload);
        await onRefresh();
      }}
      onDisconnectSlack={async () => {
        await window.ax.disconnectSlack();
        await onRefresh();
      }}
      onConnectGmail={() => window.ax.connectGmailOAuth().then(onRefresh)}
      onDisconnectGmail={() => window.ax.disconnectGmailOAuth().then(onRefresh)}
      onPickLocalFolder={() => window.ax.pickLocalFolder()}
      onAddLocalFolder={async (payload) => {
        await window.ax.addLocalFolder(payload);
        await onRefresh();
      }}
      onRemoveLocalFolder={async (folderId) => {
        await window.ax.removeLocalFolder(folderId);
        await onRefresh();
      }}
      onConnectHttp={async (payload) => {
        await window.ax.connectHttp(payload);
        await onRefresh();
      }}
      onDisconnectHttp={async (endpointId) => {
        await window.ax.disconnectHttp(endpointId);
        await onRefresh();
      }}
      onConnectWebhook={async (payload) => {
        await window.ax.connectWebhook(payload);
        await onRefresh();
      }}
      onDisconnectWebhook={async () => {
        await window.ax.disconnectWebhook();
        await onRefresh();
      }}
      onPickSqliteFile={() => window.ax.pickSqliteFile()}
      onConnectRdb={async (payload) => {
        await window.ax.connectRdb(payload);
        await onRefresh();
      }}
      onDisconnectRdb={async () => {
        await window.ax.disconnectRdb();
        await onRefresh();
      }}
      onConnectOpenApi={async (payload) => {
        await window.ax.connectOpenApi(payload);
        await onRefresh();
      }}
      onDisconnectOpenApi={async () => {
        await window.ax.disconnectOpenApi();
        await onRefresh();
      }}
      onConnectMcp={async (payload) => {
        await window.ax.connectMcp(payload);
        await onRefresh();
      }}
      onDisconnectMcp={async () => {
        await window.ax.disconnectMcp();
        await onRefresh();
      }}
    />
  );
}
