import type { AiBrand, AiConnectionMode, CliModelOption, DetectedAiCli } from '../../../../types/ai-provider';

export interface AiBrandFormProps {
  brand: AiBrand;
  embedded?: boolean;
  mode: AiConnectionMode;
  model: string;
  models: CliModelOption[];
  cliOption?: DetectedAiCli;
  detecting: boolean;
  apiKeyDraft: string;
  apiKeyConfigured: boolean;
  apiKeyMasked?: string;
  configFilePath?: string;
  cliVerified: boolean;
  apiVerified: boolean;
  saving: boolean;
  testing: boolean;
  testingCli: boolean;
  message: string;
  canSave: boolean;
  isActive: boolean;
  onModeChange: (mode: AiConnectionMode) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onTestCli: () => void;
  onTestApiKey: () => void;
  onSave: () => void;
}
