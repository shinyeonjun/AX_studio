export function emailAddresses(value) {
  return typeof value === 'string'
    ? [...value.matchAll(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu)].map((match) => match[0].toLowerCase())
    : [];
}

export function isAllowedTestChannel(value, allowedIds) {
  const channel = typeof value === 'string' ? value.trim() : '';
  return /(?:^|[#\s])ax테스트(?:2|3)?(?:$|\s)/iu.test(channel) || allowedIds.has(channel);
}

export function isAllowedTestRecipients(value, allowedEmails) {
  const recipients = new Set(emailAddresses(value));
  return allowedEmails.size > 0
    && recipients.size === allowedEmails.size
    && [...allowedEmails].every((email) => recipients.has(email));
}
