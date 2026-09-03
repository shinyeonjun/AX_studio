export function extractJsonText(raw: string): string {
  const trimmed = raw.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf('{');
  if (start >= 0) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const character = trimmed[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (character === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (character === '{') depth += 1;
      if (character === '}' && --depth === 0) return trimmed.slice(start, index + 1);
    }
  }
  return trimmed;
}

export function parseJsonObject(raw: string): unknown {
  const text = extractJsonText(raw);
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('AI structured output was empty');
  }
  if (trimmed.startsWith('error:') || trimmed.startsWith('Error:')) {
    throw new Error(trimmed.split('\n')[0]!.slice(0, 500));
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    if (err instanceof SyntaxError) {
      const repaired = escapeControlCharactersInJsonStrings(text);
      if (repaired !== text) {
        try {
          return JSON.parse(repaired);
        } catch {
          // Fall through to the stable provider-facing diagnostic below.
        }
      }
      throw new Error(`AI structured output was not valid JSON: ${trimmed.slice(0, 160)}`);
    }
    throw err;
  }
}

/**
 * Some CLI models emit literal line breaks inside a JSON string even though
 * the outer response is otherwise JSON-shaped. Repair only JSON string
 * control characters; never evaluate or otherwise reinterpret the payload.
 */
function escapeControlCharactersInJsonStrings(text: string): string {
  let inString = false;
  let escaped = false;
  let repaired = '';

  for (const character of text) {
    if (escaped) {
      repaired += character;
      escaped = false;
      continue;
    }

    if (character === '\\' && inString) {
      repaired += character;
      escaped = true;
      continue;
    }

    if (character === '"') {
      repaired += character;
      inString = !inString;
      continue;
    }

    if (inString) {
      if (character === '\n') {
        repaired += '\\n';
        continue;
      }
      if (character === '\r') {
        repaired += '\\r';
        continue;
      }
      if (character === '\t') {
        repaired += '\\t';
        continue;
      }
      const code = character.charCodeAt(0);
      if (code < 0x20) {
        repaired += `\\u${code.toString(16).padStart(4, '0')}`;
        continue;
      }
    }

    repaired += character;
  }

  return repaired;
}
