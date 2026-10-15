import { useCallback, useRef, useState } from 'react';
import type { AiBrand, DetectedAiCli } from '../../../../types/ai-provider';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';

export function useAiDetection() {
  const [cliProviders, setCliProviders] = useState<DetectedAiCli[]>([]);
  const [verifiedCli, setVerifiedCli] = useState<Partial<Record<AiBrand, boolean>>>({});
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState('');
  const latestRequest = useRef(0);
  const [configFilePath, setConfigFilePath] = useState<string | undefined>();

  const refreshDetection = useCallback(async () => {
    const request = ++latestRequest.current;
    setDetecting(true);
    setError('');
    try {
      const [detected, aiConfig] = await Promise.all([
        window.ax.detectAiCli(),
        window.ax.getAiConfig(),
      ]);
      if (request === latestRequest.current) {
        setCliProviders(detected);
        setConfigFilePath(aiConfig.path);
      }
      return { detected, aiConfig };
    } catch (error) {
      if (request === latestRequest.current) {
        setError(ipcErrorMessage(error, 'AI 연결 상태를 확인하지 못했습니다.'));
      }
      throw error;
    } finally {
      if (request === latestRequest.current) setDetecting(false);
    }
  }, []);

  return {
    cliProviders,
    verifiedCli,
    setVerifiedCli,
    detecting,
    error,
    configFilePath,
    refreshDetection,
  };
}
