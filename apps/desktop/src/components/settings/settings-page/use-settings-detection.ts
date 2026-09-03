import { useEffect } from 'react';
import { brandFromSettingsScreen } from '../../../constants/settings';
import { useAiDetection } from '../../../hooks/ai-settings/useAiDetection';
import type { SettingsScreen } from '../../../types/navigation';

export function useSettingsDetection(screen: SettingsScreen) {
  const detection = useAiDetection();
  const { setDetecting, refreshDetection } = detection;
  const detailBrand = brandFromSettingsScreen(screen);
  const refreshKey = screen === 'hub' ? 'hub' : detailBrand;

  useEffect(() => {
    if (!refreshKey) return;
    let cancelled = false;
    (async () => {
      setDetecting(true);
      try {
        await refreshDetection();
      } finally {
        if (!cancelled) setDetecting(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh only when hub or AI brand changes
  }, [refreshKey]);

  return detection;
}
