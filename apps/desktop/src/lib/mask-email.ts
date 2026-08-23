/** Mask connected account email for screen-share safe display. */
export function maskEmail(email: string): string {
  const trimmed = email.trim();
  const at = trimmed.indexOf('@');
  if (at <= 1) return '••••@••••';
  const local = trimmed.slice(0, at);
  const domain = trimmed.slice(at + 1);
  const maskedLocal = local.length <= 2 ? `${local[0] ?? ''}•` : `${local.slice(0, 2)}•••`;
  const dot = domain.lastIndexOf('.');
  if (dot <= 0) return `${maskedLocal}@${domain}`;
  const domainName = domain.slice(0, dot);
  const tld = domain.slice(dot);
  const maskedDomain = domainName.length <= 2 ? `${domainName[0] ?? ''}•` : `${domainName.slice(0, 2)}•••`;
  return `${maskedLocal}@${maskedDomain}${tld}`;
}
