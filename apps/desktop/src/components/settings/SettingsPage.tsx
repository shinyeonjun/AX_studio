import type { SettingsScreen } from '../../types/navigation';
import type { AppState } from '../../types/app-state';
import type { AiBrand } from '../../types/ai-provider';
import type { AiSettingsController } from '../../hooks/useAiSettings';
import { brandFromSettingsScreen, SETTINGS_TITLES } from '../../constants/settings';
import { PageHeader } from '../layout/PageHeader';
import { ConnectorHub } from './connectors/ConnectorHub';
import { AiHub } from './ai/AiHub';
import { AiBrandForm } from './ai/AiBrandForm';
import { SlackConnectionForm } from './connectors/SlackConnectionForm';
import { GmailConnectionForm } from './connectors/GmailConnectionForm';

interface SettingsPageProps {
  screen: SettingsScreen;
  state: AppState | null;
  aiSettings: AiSettingsController;
  onScreenChange: (screen: SettingsScreen) => void;
  onOpenAi: () => void;
  onOpenAiBrand: (brand: AiBrand) => void;
  onConnectSlack: (token: string) => Promise<void>;
  onConnectGmail: () => Promise<void>;
  onDisconnectGmail: () => Promise<void>;
}

function settingsSubtitle(screen: SettingsScreen): string {
  if (screen === 'hub') return 'AI와 외부 서비스를 연결하세요';
  if (screen === 'ai') return 'Claude, GPT, Grok 중 하나를 선택하세요';
  if (screen.startsWith('ai-')) return 'CLI 또는 API를 선택해 적용하세요';
  return '인증 정보를 입력하고 연결합니다';
}

function settingsBackTarget(screen: SettingsScreen): SettingsScreen | null {
  if (screen === 'hub') return null;
  if (screen.startsWith('ai-') && screen !== 'ai') return 'ai';
  return 'hub';
}

export function SettingsPage({
  screen,
  state,
  aiSettings,
  onScreenChange,
  onOpenAi,
  onOpenAiBrand,
  onConnectSlack,
  onConnectGmail,
  onDisconnectGmail,
}: SettingsPageProps) {
  const backTarget = settingsBackTarget(screen);
  const detailBrand = aiSettings.brand ?? brandFromSettingsScreen(screen);

  return (
    <>
      <PageHeader
        title={SETTINGS_TITLES[screen]}
        subtitle={settingsSubtitle(screen)}
        backLabel={backTarget ? (backTarget === 'ai' ? '← AI 목록' : '← 연결 목록') : undefined}
        onBack={backTarget ? () => onScreenChange(backTarget) : undefined}
      />
      <div className="page-content">
        {screen === 'hub' && (
          <ConnectorHub
            state={state}
            onOpenAi={onOpenAi}
            onOpenConnector={(screen) => onScreenChange(screen)}
          />
        )}
        {screen === 'ai' && (
          <AiHub
            state={state}
            detecting={aiSettings.detecting}
            activeBrand={aiSettings.activeBrand}
            brandStatus={aiSettings.brandStatus}
            brandMode={aiSettings.brandMode}
            modeSaving={aiSettings.saving}
            hubMessage={aiSettings.hubMessage}
            onSelectBrand={(brand) => void aiSettings.selectBrand(brand)}
            onBrandModeChange={aiSettings.setBrandMode}
            onOpenBrand={onOpenAiBrand}
          />
        )}
        {detailBrand && screen.startsWith('ai-') && (
          <AiBrandForm
            brand={detailBrand}
            mode={aiSettings.mode}
            model={aiSettings.model}
            models={aiSettings.models}
            cliOption={aiSettings.cliProviders.find(
              (item) => item.id === (detailBrand === 'claude' ? 'claude-cli' : detailBrand === 'gpt' ? 'codex-cli' : 'cursor-cli'),
            )}
            detecting={aiSettings.detecting}
            apiKeyDraft={aiSettings.apiKeyDraft}
            apiKeyConfigured={aiSettings.apiKeyConfigured}
            apiKeyMasked={aiSettings.apiKeyMasked}
            configFilePath={aiSettings.configFilePath}
            cliVerified={aiSettings.cliVerified}
            apiVerified={aiSettings.apiVerified}
            saving={aiSettings.saving}
            testing={aiSettings.testing}
            testingCli={aiSettings.testingCli}
            message={aiSettings.message}
            canSave={aiSettings.canSave}
            isActive={aiSettings.activeBrand === detailBrand}
            onModeChange={aiSettings.selectMode}
            onModelChange={aiSettings.setModel}
            onApiKeyChange={aiSettings.setApiKeyDraft}
            onTestCli={aiSettings.testCli}
            onTestApiKey={aiSettings.testApiKey}
            onSave={aiSettings.save}
          />
        )}
        {screen === 'slack' && <SlackConnectionForm state={state} onConnect={onConnectSlack} />}
        {screen === 'gmail' && (
          <GmailConnectionForm
            state={state}
            onConnect={onConnectGmail}
            onDisconnect={onDisconnectGmail}
          />
        )}
      </div>
    </>
  );
}
