import { AI_PROVIDER_UI_CATALOG } from '../constants/ai-providers';
import type { AiBrand } from '../types/ai-provider';

export function aiBrandStatusLabel(
  brand: AiBrand,
  status: 'active' | 'ready' | 'off',
): string {
  if (status === 'active') return '사용 중';
  if (status === 'ready') return brand === 'ollama' ? '설치됨' : '선택 가능';
  if (!AI_PROVIDER_UI_CATALOG[brand].enabled) return '지원 예정';
  return brand === 'ollama' ? '설치 필요' : '미연결';
}
