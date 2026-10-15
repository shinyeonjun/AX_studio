import { useEffect } from 'react';
import type { SettingsScreen } from '../../../types/navigation';
import { SETTINGS_TITLES } from '../../../ui/constants/settings';
import { PageHeader } from '../../../ui/layout/PageHeader';
import { SettingsPageContent } from './settings-page/content';
import type { SettingsPageProps } from './settings-page/contracts';

function settingsSubtitle(screen: SettingsScreen): string {
  if (screen === 'hub') return '카테고리별로 연결할 항목을 선택하세요';
  if (screen === 'ai-jev') return 'Jev를 켜고 끄고, 같은 요청을 함께 판단할지 정합니다';
  if (screen.startsWith('ai-')) return '설치된 CLI와 모델을 확인해 적용하세요';
  if (screen === 'local-folder') return '업무 파일이 있는 폴더를 연결합니다';
  return '연결 정보를 입력하고 연결합니다';
}

function settingsBackTarget(screen: SettingsScreen): SettingsScreen | null {
  return screen === 'hub' ? null : 'hub';
}

export function SettingsPage(props: SettingsPageProps) {
  const { screen, onScreenChange, detection } = props;
  const { detecting, refreshDetection } = detection;
  const backTarget = settingsBackTarget(screen);

  useEffect(() => {
    if (screen === 'hub') {
      void refreshDetection().catch(() => {});
    }
  }, [screen, refreshDetection]);

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
