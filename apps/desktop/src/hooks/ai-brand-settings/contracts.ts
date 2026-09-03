import type { Dispatch, SetStateAction } from 'react';
import type { useAiDetection } from '../ai-settings/useAiDetection';
import type { AiBrand, AiConnectionMode, AiSecretStatus, DetectedAiCli } from '../../types/ai-provider';
import type { AiProviderState, AppState } from '../../types/app-state';

type AiDetection = ReturnType<typeof useAiDetection>;

export interface AiBrandSettingsActionsInput {
  brand: AiBrand;
  state: AppState | null;
  onRefresh: () => Promise<void>;
  refreshDetection: AiDetection['refreshDetection'];
  mode: AiConnectionMode;
  model: string;
  apiKeyDraft: string;
  cliProviders: DetectedAiCli[];
  brandSecrets: Record<string, AiSecretStatus>;
  verifiedCli: Partial<Record<AiBrand, boolean>>;
  verifiedApi: Partial<Record<AiBrand, boolean>>;
  isActive: boolean;
  canSave: boolean;
  setMode: Dispatch<SetStateAction<AiConnectionMode>>;
  setModel: Dispatch<SetStateAction<string>>;
  setApiKeyDraft: Dispatch<SetStateAction<string>>;
  setApiKeyConfigured: Dispatch<SetStateAction<boolean>>;
  setApiKeyMasked: Dispatch<SetStateAction<string | undefined>>;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setTesting: Dispatch<SetStateAction<boolean>>;
  setTestingCli: Dispatch<SetStateAction<boolean>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setVerifiedCli: AiDetection['setVerifiedCli'];
  setVerifiedApi: AiDetection['setVerifiedApi'];
}

export type AiBrandSelectionActionsInput = Pick<
  AiBrandSettingsActionsInput,
  'brand' | 'state' | 'cliProviders' | 'isActive' | 'setMode' | 'setModel'
>;

export type AiBrandVerificationActionsInput = Pick<
  AiBrandSettingsActionsInput,
  | 'brand'
  | 'mode'
  | 'apiKeyDraft'
  | 'onRefresh'
  | 'refreshDetection'
  | 'setApiKeyDraft'
  | 'setApiKeyConfigured'
  | 'setApiKeyMasked'
  | 'setMessage'
  | 'setTesting'
  | 'setTestingCli'
  | 'setVerifiedApi'
  | 'setVerifiedCli'
>;

export type AiBrandConfigurationActionsInput = Pick<
  AiBrandSettingsActionsInput,
  | 'brand'
  | 'mode'
  | 'model'
  | 'apiKeyDraft'
  | 'cliProviders'
  | 'brandSecrets'
  | 'verifiedCli'
  | 'verifiedApi'
  | 'isActive'
  | 'canSave'
  | 'onRefresh'
  | 'refreshDetection'
  | 'setApiKeyDraft'
  | 'setApiKeyConfigured'
  | 'setMessage'
  | 'setSaving'
  | 'setVerifiedApi'
>;

export type { AiProviderState };
