import type { WebClient } from '@slack/web-api';
import { slackRead } from './request.js';

const MAX_NAME_LOOKUPS = 50;
const MEMBER_ID = /^[UW][A-Z0-9]+$/u;
const MENTION = /<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/gu;

/** Member ids a page of messages names: who wrote each, and who each one mentions. */
export function slackMemberIds(messages: ReadonlyArray<{ user?: string; text?: string }>): string[] {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message.user && MEMBER_ID.test(message.user)) ids.add(message.user);
    for (const match of (message.text ?? '').matchAll(MENTION)) ids.add(match[1]!);
  }
  return [...ids];
}

/**
 * Display names for member ids, best effort. Without the users:read scope the first ask fails and
 * no more are made; any id without a name stays as the id.
 */
export async function slackUserNames(client: WebClient, ids: readonly string[], signal?: AbortSignal): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const wanted = ids.slice(0, MAX_NAME_LOOKUPS);
  if (wanted.length === 0 || typeof client.users?.info !== 'function') return names;
  const lookup = async (id: string) => {
    const response = await slackRead(() => client.users.info({ user: id }), signal);
    const profile = response.user?.profile;
    const name = profile?.display_name?.trim() || profile?.real_name?.trim() || response.user?.real_name?.trim() || response.user?.name;
    if (name) names.set(id, name);
  };
  try {
    await lookup(wanted[0]!);
  } catch {
    signal?.throwIfAborted();
    return names;
  }
  await Promise.all(wanted.slice(1).map((id) => lookup(id).catch(() => { signal?.throwIfAborted(); })));
  return names;
}

/** Slack's markup as people read it: <#C1|general> → #general, <https://x|보기> → 보기 (https://x), <@U1> → @이름. */
export function readableSlackText(text: string, names: ReadonlyMap<string, string>): string {
  return text
    .replace(MENTION, (_whole, id: string) => `@${names.get(id) ?? id}`)
    .replace(/<#([CG][A-Z0-9]+)(?:\|([^>]*))?>/gu, (_whole, id: string, name?: string) => `#${name || id}`)
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/gu, '@$1')
    .replace(/<!subteam\^[A-Z0-9]+\|([^>]+)>/gu, '$1')
    .replace(/<((?:https?|mailto):[^|>]+)\|([^>]+)>/gu, (_whole, url: string, label: string) =>
      url.replace(/^mailto:/u, '') === label ? label : `${label} (${url})`)
    .replace(/<((?:https?|mailto):[^>]+)>/gu, (_whole, url: string) => url.replace(/^mailto:/u, ''))
    .replace(/&lt;/gu, '<').replace(/&gt;/gu, '>').replace(/&amp;/gu, '&');
}
