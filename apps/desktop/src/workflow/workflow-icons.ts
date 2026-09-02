import { getCapability } from '@ax-studio/core/catalog-data';
import { CONNECTOR_UI_CATALOG, type ConnectorUiId } from '../constants/connectors.js';
import gmailIcon from '../images/connectors/gmail.png';
import slackIcon from '../images/connectors/slack.png';
import folderIcon from '../images/connectors/folder.svg';
import documentIcon from '../images/connectors/document.svg';

export interface WorkflowNodeIcon {
  src?: string;
  emoji?: string;
  alt: string;
}

const CONNECTOR_IMAGE: Record<string, string> = {
  gmail: gmailIcon,
  slack: slackIcon,
  local_folder: folderIcon,
  document: documentIcon,
};

const CONNECTOR_EMOJI: Record<string, string> = {
  rdb: '🗄️',
  local_sheet: '📊',
};

const TRIGGER_EMOJI: Record<string, string> = {
  manual: '👆',
  once: '🕐',
  schedule: '📅',
};

export function triggerIconConnector(triggerType?: string): string | undefined {
  if (!triggerType) return undefined;
  const capability = getCapability(triggerType);
  return capability?.kind === 'trigger' ? capability.connector : undefined;
}

export function workflowNodeIcon(connector?: string): WorkflowNodeIcon {
  if (!connector) return { emoji: '⚙️', alt: 'Action' };

  const ui = CONNECTOR_UI_CATALOG[connector as ConnectorUiId];
  if (ui?.icon) return { src: ui.icon, alt: ui.title };

  const image = CONNECTOR_IMAGE[connector];
  if (image) return { src: image, alt: ui?.title ?? connector };

  const emoji = ui?.emojiIcon ?? CONNECTOR_EMOJI[connector] ?? '⚙️';
  return { emoji, alt: ui?.title ?? connector };
}

export function triggerNodeIcon(triggerType?: string): WorkflowNodeIcon {
  const connector = triggerIconConnector(triggerType);
  if (connector) return workflowNodeIcon(connector);
  const emoji = triggerType ? TRIGGER_EMOJI[triggerType] : undefined;
  return { emoji: emoji ?? '⚡', alt: triggerType ?? 'Trigger' };
}

export function applyWorkflowNodeIcon<T extends { iconConnector?: string; iconSrc?: string; iconEmoji?: string }>(
  display: T,
  fallbackConnector?: string,
): Omit<T, 'iconConnector'> & { iconSrc?: string; iconEmoji?: string } {
  const connector = display.iconConnector ?? fallbackConnector;
  const icon = connector ? workflowNodeIcon(connector) : { emoji: '⚙️', alt: 'Step' };
  const { iconConnector: _iconConnector, ...rest } = display;
  return {
    ...rest,
    iconSrc: icon.src,
    iconEmoji: icon.emoji,
  };
}
