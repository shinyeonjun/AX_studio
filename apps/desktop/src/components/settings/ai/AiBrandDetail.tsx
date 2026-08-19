import { AI_PROVIDER_UI_CATALOG } from '../../../constants/ai-providers';
import type { AiBrand } from '../../../types/ai-provider';
import type { AppState } from '../../../types/app-state';
import type { useAiDetection } from '../../../hooks/ai-settings/useAiDetection';
import { useAiBrandSettings } from '../../../hooks/useAiBrandSettings';
import { AiBrandForm } from './AiBrandForm';

type AiDetection = ReturnType<typeof useAiDetection>;

interface AiBrandDetailProps {
  brand: AiBrand;
  state: AppState | null;
  detecting: boolean;
  onRefresh: () => Promise<void>;
  detection: AiDetection;
}

export function AiBrandDetail({ brand, state, detecting, onRefresh, detection }: AiBrandDetailProps) {
  const panel = useAiBrandSettings(brand, state, onRefresh, detection);
  const meta = AI_PROVIDER_UI_CATALOG[brand];

  if (!panel.initialized) {
    return <p className="muted">{meta.title} 설정 불러오는 중...</p>;
  }

  return (
    <AiBrandForm
      brand={brand}
      mode={panel.mode}
      model={panel.model}
      models={panel.models}
      cliOption={panel.selectedCli}
      detecting={detecting}
      apiKeyDraft={panel.apiKeyDraft}
      apiKeyConfigured={panel.apiKeyConfigured}
      apiKeyMasked={panel.apiKeyMasked}
      configFilePath={panel.configFilePath}
      cliVerified={panel.cliVerified}
      apiVerified={panel.apiVerified}
      saving={panel.saving}
      testing={panel.testing}
      testingCli={panel.testingCli}
      message={panel.message}
      canSave={panel.canSave}
      isActive={panel.isActive}
      onModeChange={panel.selectMode}
      onModelChange={panel.setModel}
      onApiKeyChange={panel.setApiKeyDraft}
      onTestCli={() => void panel.testCli()}
      onTestApiKey={() => void panel.testApiKey()}
      onSave={() => void panel.save()}
    />
  );
}
