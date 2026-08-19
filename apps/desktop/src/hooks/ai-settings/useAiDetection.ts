import { useState } from 'react';
import type { AiBrand, AiSecretStatus, DetectedAiCli } from '../../types/ai-provider';

export function useAiDetection() {
  const [cliProviders, setCliProviders] = useState<DetectedAiCli[]>([]);
  const [brandSecrets, setBrandSecrets] = useState<Record<string, AiSecretStatus>>({});
  const [verifiedCli, setVerifiedCli] = useState<Partial<Record<AiBrand, boolean>>>({});
  const [verifiedApi, setVerifiedApi] = useState<Partial<Record<AiBrand, boolean>>>({});
  const [detecting, setDetecting] = useState(false);
  const [configFilePath, setConfigFilePath] = useState<string | undefined>();

  const refreshDetection = async () => {
    const [detected, aiConfig] = await Promise.all([
      window.ax.detectAiCli(),
      window.ax.getAiConfig(),
    ]);
    setCliProviders(detected);
    setBrandSecrets(aiConfig.secrets);
    setConfigFilePath(aiConfig.path);
    return { detected, aiConfig };
  };

  return {
    cliProviders,
    brandSecrets,
    verifiedCli,
    setVerifiedCli,
    verifiedApi,
    setVerifiedApi,
    detecting,
    setDetecting,
    configFilePath,
    refreshDetection,
  };
}
