import type { AiBrand, CliModelOption, DetectedAiCli } from '../../../../../types/ai-provider';

export interface AiBrandFormProps {
  brand: AiBrand;
  embedded?: boolean;
  model: string;
  models: CliModelOption[];
  cliOption?: DetectedAiCli;
  detecting: boolean;
  cliVerified: boolean;
  saving: boolean;
  testingCli: boolean;
  message: string;
  messageIsError?: boolean;
  canSave: boolean;
  onModelChange: (value: string) => void;
  onTestCli: () => void;
  onSave: () => void;
}
