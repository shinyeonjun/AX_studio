const MAX_NUMERIC_CANDIDATES = 8;
const LIMIT_PARAMETER_NAMES = new Set(['count', 'limit', 'pagesize', 'perpage', 'per_page', 'size', 'top']);

/** Extract numeric literals only; Jev decides whether any literal is a result limit. */
export function requestNumericLiterals(message: string): number[] {
  const values = new Set<number>();
  for (const match of message.matchAll(/-?\d[\d,]*(?:\.\d+)?/gu)) {
    const value = Number(match[0].replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    values.add(value);
    if (values.size === MAX_NUMERIC_CANDIDATES) break;
  }
  return [...values];
}

/** Numeric count candidates only; Jev decides which one, if any, is a result limit. */
export function requestLimitCandidates(message: string): number[] {
  const explicitlyAssigned = new Set([...message.matchAll(
    /(?:^|[?&\s])([\p{L}_][\p{L}\p{N}_.-]*)\s*[=:]\s*(-?\d[\d,]*(?:\.\d+)?)/gu,
  )].flatMap((match) => LIMIT_PARAMETER_NAMES.has(match[1]!.toLowerCase())
    ? []
    : [Number(match[2]!.replace(/,/g, ''))]));
  return requestNumericLiterals(message).filter((value) =>
    Number.isSafeInteger(value) && value > 0 && !explicitlyAssigned.has(value),
  );
}
