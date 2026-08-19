import gmailIcon from '../images/connectors/gmail.png';
import slackIcon from '../images/connectors/slack.png';

const CONNECTOR_ICONS: Record<string, string> = {
  gmail: gmailIcon,
  slack: slackIcon,
};

export function connectorIconSrc(connector?: string): string | undefined {
  if (!connector) return undefined;
  return CONNECTOR_ICONS[connector];
}

export function triggerIconSrc(triggerType?: string): string | undefined {
  if (triggerType === 'gmail.new_message') return gmailIcon;
  if (triggerType === 'slack.new_message') return slackIcon;
  return undefined;
}
