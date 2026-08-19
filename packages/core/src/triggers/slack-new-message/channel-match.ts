export interface SlackChannelRef {
  channel: string;
  channelId: string;
}

export function slackChannelMatches(triggerChannel: string, event: SlackChannelRef): boolean {
  const trigger = triggerChannel.trim().toLowerCase();
  const eventChannel = event.channel.trim().toLowerCase();
  const eventId = event.channelId.trim().toLowerCase();

  if (!trigger) return false;
  if (trigger === eventId) return true;
  if (trigger.startsWith('#') && trigger === eventChannel) return true;
  if (trigger.startsWith('#') && trigger.slice(1) === eventChannel.replace(/^#/, '')) return true;
  if (!trigger.startsWith('#') && `#${trigger}` === eventChannel) return true;
  if (trigger === eventChannel.replace(/^#/, '')) return true;
  return false;
}
