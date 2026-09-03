import { getConnectorLabel } from '../../../../catalog/connectors.js';

export function connectionGuidance(
  missingConnections: string[] | undefined,
): { message: string; connectors: string[] } | null {
  if (!missingConnections?.length) return null;
  const labels = missingConnections.map((connector) => getConnectorLabel(connector));
  return {
    connectors: [...missingConnections],
    message: `${labels.join(', ')} 연결이 필요합니다. 설정에서 연결해 주세요.`,
  };
}
