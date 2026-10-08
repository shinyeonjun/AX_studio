/**
 * Which place the person picked when a request fitted several ("주문 목록 보여줘" → 물류 DB).
 * Kept for the workspace and given to Jev as background, so the same kind of request is not
 * asked about again and goes where this person means.
 */
export interface SourceChoice {
  request: string;
  place: string;
}

export const MAX_SOURCE_CHOICES = 30;
const MAX_REQUEST_CHARS = 200;
const MAX_PLACE_CHARS = 80;

function normalized(text: string): string {
  return text.trim().replace(/\s+/gu, ' ').toLowerCase();
}

export function validSourceChoice(value: unknown): value is SourceChoice {
  const choice = value as Partial<SourceChoice> | null;
  return typeof choice?.request === 'string' && typeof choice.place === 'string'
    && choice.request.trim().length > 0 && choice.request.length <= MAX_REQUEST_CHARS
    && choice.place.trim().length > 0 && choice.place.length <= MAX_PLACE_CHARS;
}

/** The choices with a new one last; the same request keeps only its latest place. */
export function mergeSourceChoices(known: readonly SourceChoice[], choice: SourceChoice): SourceChoice[] {
  const clean = { request: choice.request.trim().slice(0, MAX_REQUEST_CHARS), place: choice.place.trim().slice(0, MAX_PLACE_CHARS) };
  const kept = known.filter((entry) => normalized(entry.request) !== normalized(clean.request));
  return [...kept, clean].slice(-MAX_SOURCE_CHOICES);
}
