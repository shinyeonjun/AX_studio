import { createAiBrandConfigurationActions } from './configuration-actions';
import { createAiBrandSelectionActions } from './selection-actions';
import { createAiBrandVerificationActions } from './verification-actions';
import type { AiBrandSettingsActionsInput } from './contracts';

export function createAiBrandSettingsActions(input: AiBrandSettingsInput) {
  const selection = createAiBrandSelectionActions(input);
  const verification = createAiBrandVerificationActions(input);
  const configuration = createAiBrandConfigurationActions(input);

  return {
    activateBrand: configuration.activateBrand,
    selectMode: selection.selectMode,
    testCli: verification.testCli,
    testApiKey: verification.testApiKey,
    save: configuration.save,
  };
}

type AiBrandSettingsInput = AiBrandSettingsActionsInput;
