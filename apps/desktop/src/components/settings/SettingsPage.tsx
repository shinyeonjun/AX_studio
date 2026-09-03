import { useEffect } from 'react';
import type { SettingsScreen } from '../../types/navigation';
import { isSettingsScreenVisibleInUi, SETTINGS_TITLES } from '../../constants/settings';
import { PageHeader } from '../layout/PageHeader';
import { SettingsPageContent } from './settings-page/content';
import type { SettingsPageProps } from './settings-page/contracts';
import { useSettingsDetection } from './settings-page/use-settings-detection';

function settingsSubtitle(screen: SettingsScreen): string {
  if (screen === 'hub') return '카테고리별로 연결할 항목을 선택하세요';
  if (screen.startsWith('ai-')) return 'CLI 또는 API를 선택해 적용하세요';
  return '인증 정보를 입력하고 연결합니다';
}

function settingsBackTarget(screen: SettingsScreen): SettingsScreen | null {
  return screen === 'hub' ? null : 'hub';
}

export function SettingsPage(props: SettingsPageProps) {
  const { screen, onScreenChange, onRefresh } = props;
  const detection = useSettingsDetection(screen);
  const { detecting } = detection;
  const backTarget = settingsBackTarget(screen);

  useEffect(() => {
    if (!isSettingsScreenVisibleInUi(screen)) {
      onScreenChange('hub');
    }
  }, [screen, onScreenChange]);

  return (
    <>
      <PageHeader
        title={SETTINGS_TITLES[screen]}
        subtitle={settingsSubtitle(screen)}
        backLabel={backTarget ? '← 연결 목록' : undefined}
        onBack={backTarget ? () => onScreenChange(backTarget) : undefined}
      />
      <SettingsPageContent {...props} detecting={detecting} detection={detection} />
    </>
  );
}
