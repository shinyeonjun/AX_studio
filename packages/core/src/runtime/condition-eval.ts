const BLOCKED_PATTERN =
  /\b(import|eval|Function|process|global|window|fetch|require|constructor|__proto__|prototype)\b/;

const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

export function evaluateStepCondition(condition: string, stepResults: Record<string, unknown>): boolean {
  const trimmed = condition.trim();
  if (!trimmed || BLOCKED_PATTERN.test(trimmed)) return false;

  const keys = Object.keys(stepResults).filter((key) => IDENTIFIER.test(key));
  if (keys.length === 0) return false;

  try {
    const fn = new Function(...keys, `"use strict"; return (${trimmed});`);
    return Boolean(fn(...keys.map((key) => stepResults[key])));
  } catch {
    return false;
  }
}
