import { useMemo } from 'react';
import { AI_PROVIDER_UI_CATALOG, ENABLED_AI_PROVIDER_IDS } from '../../../constants/ai-providers';
import { aiBrandStatusLabel } from '../../../lib/ai-brand-labels';
import type { AiBrand, AiConnectionMode } from '../../../types/ai-provider';
import type { AppState } from '../../../types/app-state';
import type { AiHubController } from '../../../hooks/useAiHub';
import { AiModeSwitch } from './AiModeSwitch';

interface AiHubCardsProps {
  state: AppState | null;
  detecting: boolean;
  hub: AiHubController;
  onOpenBrand: (brand: AiBrand) => void;
}

function sortBrands(activeBrand: AiBrand | null): AiBrand[] {
  if (!activeBrand) return [...ENABLED_AI_PROVIDER_IDS];
  return [activeBrand, ...ENABLED_AI_PROVIDER_IDS.filter((brand) => brand !== activeBrand)];
}

export function AiHubCards({ state, detecting, hub, onOpenBrand }: AiHubCardsProps) {
  const brands = useMemo(() => sortBrands(hub.activeBrand), [hub.activeBrand]);

  const handleCardActivate = (brand: AiBrand, status: 'active' | 'ready' | 'off') => {
    if (hub.modeSaving || hub.activeBrand === brand) return;
    if (status === 'ready') void hub.selectBrand(brand);
    else onOpenBrand(brand);
  };

  return (
    <>
      {detecting && <p className="muted settings-hub-note">AI 연결 상태를 확인하는 중...</p>}
      {hub.hubMessage && <p className="muted settings-hub-note">{hub.hubMessage}</p>}
      <div className="connection-hub">
        {brands.map((brand) => {
          const meta = AI_PROVIDER_UI_CATALOG[brand];
          const status = hub.brandStatus(brand);
          const isActive = hub.activeBrand === brand;
          const mode = hub.brandMode(brand);
          const selectable = status === 'ready';

          return (
            <div
              key={brand}
              className={`connection-card ai-provider-card ${isActive ? 'selected' : ''} ${!isActive && !hub.modeSaving ? 'clickable' : ''}`}
              role={isActive ? undefined : 'button'}
              tabIndex={isActive || hub.modeSaving ? -1 : 0}
              aria-label={
                isActive
                  ? `${meta.title} 사용 중`
                  : selectable
                    ? `${meta.title} 선택`
                    : `${meta.title} 설정 열기`
              }
              aria-pressed={isActive}
              onClick={() => handleCardActivate(brand, status)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  handleCardActivate(brand, status);
                }
              }}
            >
              <span className={`ai-provider-select ${isActive ? 'selected' : ''}`} aria-hidden>
                {isActive && <span className="ai-provider-select-mark" />}
              </span>

              <div className="ai-provider-card-header">
                <img src={meta.icon} alt="" className="connection-card-icon" />
                <div className="connection-card-body">
                  <div className="connection-card-title">{meta.title}</div>
                  <div className="connection-card-desc">
                    {isActive
                      ? `${state?.aiProviderLabel ?? meta.title} · 사용 중`
                      : meta.description}
                  </div>
                </div>
                <span
                  className={`connection-badge ${status === 'active' ? 'connected' : status === 'ready' ? 'ready' : ''}`}
                >
                  {aiBrandStatusLabel(brand, status)}
                </span>
              </div>

              <div
                className="ai-provider-card-footer"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <AiModeSwitch
                  mode={mode}
                  cliLabel={meta.cliModeLabel}
                  disabled={hub.modeSaving}
                  onChange={(nextMode: AiConnectionMode) => void hub.setBrandMode(brand, nextMode)}
                />
                <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenBrand(brand)}>
                  설정
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
