import type { SettingsScreen } from '../../types/navigation';
import type { AppState } from '../../types/app-state';
import type { AiBrand, AiConnectionMode, CliModelOption } from '../../types/ai-provider';
import type { DetectedAiCli } from '../../types/ai-provider';
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
  cliProviders: DetectedAiCli[];
  detecting: boolean;
  activeBrand: AiBrand | null;
  brandStatus: (brand: AiBrand) => 'active' | 'ready' | 'off';
  brandMode: (brand: AiBrand) => AiConnectionMode;
  modeSaving: boolean;
  hubMessage: string;
  onSelectBrand: (brand: AiBrand) => void;
  onBrandModeChange: (brand: AiBrand, mode: AiConnectionMode) => void;
  aiBrand: AiBrand | null;
  aiMode: AiConnectionMode;
  aiModel: string;
  aiModels: CliModelOption[];
  apiKeyDraft: string;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
  configFilePath?: string;
  cliVerified: boolean;
  apiVerified: boolean;
  aiSaving: boolean;
  aiTesting: boolean;
  aiTestingCli: boolean;
  aiMessage: string;
  canSaveAi: boolean;
  onScreenChange: (screen: SettingsScreen) => void;
  onOpenAi: () => void;
  onOpenAiBrand: (brand: AiBrand) => void;
  onAiModeChange: (mode: AiConnectionMode) => void;
  onAiModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onTestCli: () => void;
  onTestApiKey: () => void;
  onSaveAi: () => void;
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
  cliProviders,
  detecting,
  activeBrand,
  brandStatus,
  brandMode,
  modeSaving,
  hubMessage,
  onSelectBrand,
  onBrandModeChange,
  aiBrand,
  aiMode,
  aiModel,
  aiModels,
  apiKeyDraft,
  apiKeyConfigured,
  apiKeyMasked,
  configFilePath,
  cliVerified,
  apiVerified,
  aiSaving,
  aiTesting,
  aiTestingCli,
  aiMessage,
  canSaveAi,
  onScreenChange,
  onOpenAi,
  onOpenAiBrand,
  onAiModeChange,
  onAiModelChange,
  onApiKeyChange,
  onTestCli,
  onTestApiKey,
  onSaveAi,
  onConnectSlack,
  onConnectGmail,
  onDisconnectGmail,
}: SettingsPageProps) {
  const backTarget = settingsBackTarget(screen);
  const detailBrand = aiBrand ?? brandFromSettingsScreen(screen);

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
            detecting={detecting}
            activeBrand={activeBrand}
            brandStatus={brandStatus}
            brandMode={brandMode}
            modeSaving={modeSaving}
            hubMessage={hubMessage}
            onSelectBrand={onSelectBrand}
            onBrandModeChange={onBrandModeChange}
            onOpenBrand={onOpenAiBrand}
          />
        )}
        {detailBrand && screen.startsWith('ai-') && (
          <AiBrandForm
            brand={detailBrand}
            mode={aiMode}
            model={aiModel}
            models={aiModels}
            cliOption={cliProviders.find(
              (item) => item.id === (detailBrand === 'claude' ? 'claude-cli' : detailBrand === 'gpt' ? 'codex-cli' : 'cursor-cli'),
            )}
            detecting={detecting}
            apiKeyDraft={apiKeyDraft}
            apiKeyConfigured={apiKeyConfigured}
            apiKeyMasked={apiKeyMasked}
            configFilePath={configFilePath}
            cliVerified={cliVerified}
            apiVerified={apiVerified}
            saving={aiSaving}
            testing={aiTesting}
            testingCli={aiTestingCli}
            message={aiMessage}
            canSave={canSaveAi}
            isActive={activeBrand === detailBrand}
            onModeChange={onAiModeChange}
            onModelChange={onAiModelChange}
            onApiKeyChange={onApiKeyChange}
            onTestCli={onTestCli}
            onTestApiKey={onTestApiKey}
            onSave={onSaveAi}
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
