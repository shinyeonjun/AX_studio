import type { Dispatch, SetStateAction } from 'react';
import type { useAiDetection } from '../ai-settings/useAiDetection';
import type { AiBrand, DetectedAiCli } from '../../../../types/ai-provider';
import type { AiProviderState } from '../../../../types/app-state';

type AiDetection = ReturnType<typeof useAiDetection>;

export interface AiBrandSettingsActionsInput {
  brand: AiBrand;
  onRefresh: () => Promise<void>;
  refreshDetection: AiDetection['refreshDetection'];
  model: string;
  cliProviders: DetectedAiCli[];
  verifiedCli: Partial<Record<AiBrand, boolean>>;
  canSave: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;
  setTestingCli: Dispatch<SetStateAction<boolean>>;
  /** Shows a status line; `isError` styles it as an error without relying on its wording. */
  setMessage: (text: string, isError?: boolean) => void;
  setVerifiedCli: AiDetection['setVerifiedCli'];
}

export type AiBrandVerificationActionsInput = Pick<
  AiBrandSettingsActionsInput,
  'brand' | 'refreshDetection' | 'setMessage' | 'setTestingCli' | 'setVerifiedCli'
>;

export type AiBrandConfigurationActionsInput = Pick<
  AiBrandSettingsActionsInput,
  'brand' | 'model' | 'cliProviders' | 'verifiedCli' | 'canSave' | 'onRefresh' | 'refreshDetection' | 'setMessage' | 'setSaving'
>;

export type { AiProviderState };
