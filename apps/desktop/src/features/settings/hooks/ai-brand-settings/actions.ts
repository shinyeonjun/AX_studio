import { createAiBrandConfigurationActions } from './configuration-actions';
import { createAiBrandVerificationActions } from './verification-actions';
import type { AiBrandSettingsActionsInput } from './contracts';

export function createAiBrandSettingsActions(input: AiBrandSettingsActionsInput) {
  return {
    testCli: createAiBrandVerificationActions(input).testCli,
    save: createAiBrandConfigurationActions(input).save,
  };
}
