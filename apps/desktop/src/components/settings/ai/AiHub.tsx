import { useMemo } from 'react';
import { AI_PROVIDER_UI_CATALOG, ENABLED_AI_PROVIDER_IDS } from '../../../constants/ai-providers';
import type { AiBrand, AiConnectionMode } from '../../../types/ai-provider';
import type { AppState } from '../../../types/app-state';
import { AiModeSwitch } from './AiModeSwitch';

interface AiHubProps {
  state: AppState | null;
  detecting: boolean;
  activeBrand: AiBrand | null;
  brandStatus: (brand: AiBrand) => 'active' | 'ready' | 'off';
  brandMode: (brand: AiBrand) => AiConnectionMode;
  modeSaving: boolean;
  hubMessage: string;
  onSelectBrand: (brand: AiBrand) => void;
  onBrandModeChange: (brand: AiBrand, mode: AiConnectionMode) => void;
  onOpenBrand: (brand: AiBrand) => void;
}

function sortBrands(activeBrand: AiBrand | null): AiBrand[] {
  if (!activeBrand) return [...ENABLED_AI_PROVIDER_IDS];
  return [activeBrand, ...ENABLED_AI_PROVIDER_IDS.filter((brand) => brand !== activeBrand)];
}

export function AiHub({
  state,
  detecting,
  activeBrand,
  brandStatus,
  brandMode,
  modeSaving,
  hubMessage,
  onSelectBrand,
  onBrandModeChange,
  onOpenBrand,
}: AiHubProps) {
  const brands = useMemo(() => sortBrands(activeBrand), [activeBrand]);

  const handleCardActivate = (brand: AiBrand, status: 'active' | 'ready' | 'off') => {
    if (modeSaving || activeBrand === brand) return;
    if (status === 'ready') onSelectBrand(brand);
    else onOpenBrand(brand);
  };

  return (
    <div className="connection-hub">
      {detecting && (
        <p className="muted" style={{ gridColumn: '1 / -1' }}>
          연결 상태를 확인하는 중...
        </p>
      )}
      {hubMessage && (
        <p className="muted" style={{ gridColumn: '1 / -1' }}>
          {hubMessage}
        </p>
      )}
      {brands.map((brand) => {
        const meta = AI_PROVIDER_UI_CATALOG[brand];
        const status = brandStatus(brand);
        const isActive = activeBrand === brand;
        const mode = brandMode(brand);
        const selectable = status === 'ready';

        return (
          <div
            key={brand}
            className={`connection-card ai-provider-card ${isActive ? 'selected' : ''} ${!isActive && !modeSaving ? 'clickable' : ''}`}
            role={isActive ? undefined : 'button'}
            tabIndex={isActive || modeSaving ? -1 : 0}
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
            <span
              className={`ai-provider-select ${isActive ? 'selected' : ''}`}
              aria-hidden
            >
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
                {status === 'active' ? '사용 중' : status === 'ready' ? '준비됨' : '미연결'}
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
                  disabled={modeSaving}
                  onChange={(nextMode) => onBrandModeChange(brand, nextMode)}
                />
              <button type="button" className="btn btn-sm btn-secondary" onClick={() => onOpenBrand(brand)}>
                설정
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
