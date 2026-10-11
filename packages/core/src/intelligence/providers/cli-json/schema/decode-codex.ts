import type { ZodType } from 'zod';
import { zodToCodexJsonSchema } from './codex.js';

type Schema = Record<string, unknown>;

/** Inverse of the Codex wire conversion, applied only at that provider boundary.
 * Domain Zod validation still runs afterwards; never guess query syntax or types.
 */
export function decodeCodexOutput(value: unknown, schema: ZodType): unknown {
  const wire = zodToCodexJsonSchema(schema);
  return decode(value, wire, definitionsFromDescription(wire.description), []);
}

function invalidJson(path: (string | number)[]): Error {
  return Object.assign(new Error('model_output_invalid'), {
    code: 'model_output_invalid',
    issues: [{ code: 'invalid_json', path: path.slice(0, 32) }],
  });
}

function decode(value: unknown, schema: Schema, definitions: Record<string, Schema>, path: (string | number)[]): unknown {
  value = normalizeOperator(value);
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
    const definition = definitions[schema.$ref.slice('#/$defs/'.length)];
    return definition ? decode(value, definition, definitions, path) : value;
  }
  if (Array.isArray(schema.anyOf)) {
    if (value === null) return null;
    const candidate = normalizeOperator(parseNestedJson(value));
    const direct = matchingBranch(schema.anyOf, value, definitions);
    if (direct) return decode(branchInput(value, candidate, direct, definitions), direct, definitions, path);
    const branch = selectBranch(schema.anyOf, candidate, definitions);
    return branch ? decode(candidate, branch, definitions, path) : candidate;
  }
  if (Array.isArray(schema.oneOf)) {
    const candidate = normalizeOperator(parseNestedJson(value));
    const direct = matchingBranch(schema.oneOf, value, definitions);
    if (direct) return decode(branchInput(value, candidate, direct, definitions), direct, definitions, path);
    const branch = selectBranch(schema.oneOf, candidate, definitions);
    return branch ? decode(candidate, branch, definitions, path) : candidate;
  }
  const properties = schema.properties as Record<string, Schema> | undefined;
  const encoded = isEncodedStringSchema(schema);
  if (encoded) {
    const embedded = embeddedSchema(schema.description);
    // The CLI normally returns encoded JSON strings, but some models emit the
    // domain object directly. Keep the same recursive decoding contract for
    // both forms so nested encoded unions are restored before Zod validation.
    if (typeof value !== 'string') return embedded ? decode(value, embedded, definitions, path) : value;
    const parsed = parseEncodedJson(value, path);
    return embedded ? decode(parsed, embedded, definitions, path) : parsed;
  }
  if (schema.type === 'array' && Array.isArray(value)) {
    const itemSchema = schema.items as Schema;
    if (isEncodedStringSchema(itemSchema) && value.some((item) => typeof item === 'string')) {
      return decodeEncodedArray(value, itemSchema, definitions, path);
    }
    return value.map((item, index) => decode(item, itemSchema, definitions, [...path, index]));
  }
  if (properties && value && typeof value === 'object' && !Array.isArray(value)) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.filter(
      (key): key is string => typeof key === 'string',
    ) : []);
    return Object.fromEntries(Object.entries(value).flatMap(([key, item]) => {
      if (!Object.hasOwn(properties, key)) return [[key, item]];
      // Embedded domain schemas represent optional fields by leaving them out
      // of `required`; models sometimes emit those fields as explicit null.
      // Preserve required nullable values while normalizing only optional nulls.
      if (item === null && (isOptionalWireValue(properties[key]!) || !required.has(key))) return [];
      const decoded = decode(item, properties[key]!, definitions, [...path, key]);
      if (decoded === null && !required.has(key)) return [];
      return [[key, decoded]];
    }));
  }
  return value;
}

function isEncodedStringSchema(schema: Schema): boolean {
  return schema.type === 'string' && typeof schema.description === 'string'
    && schema.description.includes('encoded as a string');
}

/**
 * A structured-output model can split one encoded object across several array
 * elements (for example `{..."columns":[...],` followed by `"format":...`).
 * Reassemble only an explicitly opened JSON fragment; an orphan continuation
 * still goes through the normal invalid-json path. Strict parsing is used at
 * fragment boundaries so bounded missing-closer repair cannot prematurely
 * accept a partial object as a complete item.
 */
function decodeEncodedArray(
  values: unknown[],
  itemSchema: Schema,
  definitions: Record<string, Schema>,
  path: (string | number)[],
): unknown[] {
  const decoded: unknown[] = [];
  let fragment: string | undefined;
  let fragmentIndex = -1;
  const flush = () => {
    if (fragment === undefined) return;
    decoded.push(decode(fragment, itemSchema, definitions, [...path, fragmentIndex]));
    fragment = undefined;
    fragmentIndex = -1;
  };

  for (const [index, value] of values.entries()) {
    if (typeof value !== 'string') {
      flush();
      decoded.push(decode(value, itemSchema, definitions, [...path, index]));
      continue;
    }
    const trimmed = value.trim();
    if (fragment !== undefined) {
      // A new opening delimiter is a boundary only when the buffered text is
      // already strict JSON, or when the buffered item does not end in a
      // delimiter and can be repaired as its own bounded JSON object. A
      // trailing comma still means the next fragment belongs to this item.
      if (/^[{\[]/u.test(trimmed)
        && (isStrictJson(fragment) || !/,\s*$/u.test(fragment))) {
        try { flush(); } catch {
          // It is a continuation after all; keep the buffered fragment and
          // let the final decode report a stable path if it remains invalid.
        }
      }
      if (fragment !== undefined) {
        fragment = appendEncodedFragment(fragment, value);
        continue;
      }
    }
    if (/^[{\[]/u.test(trimmed) && (trimmed.endsWith(',') || !isStrictJson(value))) {
      fragment = value;
      fragmentIndex = index;
      continue;
    }
    decoded.push(decode(value, itemSchema, definitions, [...path, index]));
  }
  flush();
  return decoded;
}

function isStrictJson(value: string): boolean {
  try {
    JSON.parse(value);
    return true;
  } catch {
    return false;
  }
}

function appendEncodedFragment(current: string, next: string): string {
  // Some wire serializers drop the opening quote of a property when the
  // property begins a new array element (`format":...` instead of
  // `"format":...`). Restore that quote only at an object-property boundary;
  // the schema parser still rejects unknown or otherwise invalid properties.
  if (/,\s*$/u.test(current) && /^\s*[A-Za-z_$][A-Za-z0-9_$-]*":/u.test(next)) {
    const leadingWhitespace = next.match(/^\s*/u)?.[0] ?? '';
    return `${current}${leadingWhitespace}"${next.slice(leadingWhitespace.length)}`;
  }
  return current + next;
}

/**
 * Models occasionally append a fragment belonging to the surrounding wire
 * object or omit only a closing delimiter inside an encoded field. Recover
 * those bounded structural mistakes; semantic validation remains Zod's job.
 */
function parseEncodedJson(value: string, path: (string | number)[]): unknown {
  try { return JSON.parse(value); } catch {
    const prefix = completeJsonPrefix(value);
    if (prefix) {
      try { return JSON.parse(prefix); } catch { /* try delimiter repair below */ }
    }
    const repaired = closeJsonContainers(value);
    if (repaired) {
      try { return JSON.parse(repaired); } catch { /* report the bounded path */ }
    }
    throw invalidJson(path);
  }
}

function completeJsonPrefix(value: string): string | undefined {
  const start = value.search(/\S/);
  if (start < 0 || !['{', '['].includes(value[start]!)) return undefined;
  const stack: string[] = [];
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') { inString = true; continue; }
    if (character === '{' || character === '[') { stack.push(character); continue; }
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      if (stack.pop() !== expected) return undefined;
      if (!stack.length) {
        const suffix = value.slice(index + 1).trim();
        const candidate = value.slice(start, index + 1);
        if (suffix && /[^\s"'()[\]{}:,]/.test(suffix)
          && !isRepeatedEncodedSuffix(suffix, candidate)) return undefined;
        return candidate;
      }
    }
  }
  return undefined;
}

/** Some CLI structured-output failures repeat the same encoded field several
 * times with a literal pipe delimiter. Accept only exact repetitions of the
 * first complete JSON value; arbitrary suffixes remain invalid. */
function isRepeatedEncodedSuffix(suffix: string, first: string): boolean {
  const pieces = suffix.split('||||');
  return pieces.length >= 2
    && pieces[0]!.trim() === ''
    && pieces.slice(1).every((piece) => piece.trim() === first);
}

function closeJsonContainers(value: string): string | undefined {
  const start = value.search(/\S/);
  if (start < 0 || !['{', '['].includes(value[start]!)) return undefined;
  const stack: string[] = [];
  const objectKeys: Array<Set<string> | undefined> = [];
  const objectKinds: Array<string | undefined> = [];
  const lastObjectKeys: Array<string | undefined> = [];
  let insertedClosers = false;
  let repaired = value.slice(0, start);
  let inString = false;
  let escaped = false;
  let stringStart = -1;
  const pushContainer = (opening: string) => {
    stack.push(opening);
    objectKeys.push(opening === '{' ? new Set<string>() : undefined);
    objectKinds.push(undefined);
    lastObjectKeys.push(undefined);
  };
  const popContainer = (): string | undefined => {
    const opening = stack.pop();
    objectKeys.pop();
    objectKinds.pop();
    lastObjectKeys.pop();
    return opening;
  };
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') {
        inString = false;
        const token = value.slice(stringStart, index + 1);
        let decoded: unknown;
        try { decoded = JSON.parse(token); } catch { decoded = undefined; }
        const isKey = /^\s*:/u.test(value.slice(index + 1));
        const objectIndex = stack.length - 1;
        if (stack.at(-1) === '{' && typeof decoded === 'string') {
          if (isKey) {
            objectKeys[objectIndex]?.add(decoded);
            lastObjectKeys[objectIndex] = decoded;
          } else if (lastObjectKeys[objectIndex] === 'kind') {
            objectKinds[objectIndex] = decoded;
          }
        }
      }
      repaired += character;
      continue;
    }
    if (character === '"') { inString = true; stringStart = index; repaired += character; continue; }
    if (character === '}' && stack.at(-1) === '[' && /^\s*,\s*\{/u.test(value.slice(index + 1))) {
      // An extra `}` can appear where an array element should be followed by
      // the next object (`...value:0.8}}},{...}`). In an array context this
      // delimiter cannot close a valid object, so drop only this exact shape.
      insertedClosers = true;
      continue;
    }
    if (character === '}' && stack.at(-1) === '{'
      && (objectKinds.at(-1) === 'compare' || objectKinds.at(-1) === 'arithmetic')
      && objectKeys.at(-1)?.has('left') && !objectKeys.at(-1)?.has('right')
      && /^\s*,\s*"right"\s*:/u.test(value.slice(index + 1))) {
      // A malformed nested expression can close a compare/arithmetic object
      // before emitting its required right operand. Keep that typed object
      // open; generic object repairs would otherwise close its parent too.
      insertedClosers = true;
      continue;
    }
    if (character === ']' && stack.at(-1) === '{' && /^\s*\}\s*\]/u.test(value.slice(index + 1))) {
      // A grouped key may contain a nested value array. If the model emits
      // `] }]` instead of `}]`, discard only the first impossible array closer
      // so the following object and its owning array close in order.
      insertedClosers = true;
      continue;
    }
    if (character === ',' && /^\s*(?:[}\]]|$)/u.test(value.slice(index + 1))) {
      // Trailing commas are another bounded JSON-only failure: the model may
      // finish a property with `,` and omit the enclosing object closer, or
      // emit the comma immediately before a closer. Drop only a comma whose
      // next token is a closer/end; commas between values remain untouched.
      insertedClosers = true;
      continue;
    }
    if (character === ',' && stack.at(-1) === '[' && looksLikeObjectProperty(value, index + 1)) {
      // A model can omit the closing `]` after an array of objects and then
      // continue with the parent object's next property (`...},"sort":...`).
      // Close only this unambiguous array transition; arbitrary suffixes stay
      // invalid and are still rejected below.
      repaired += ']';
      popContainer();
      insertedClosers = true;
    }
    if ((character === '{' || character === '[')
      && stack.at(-1) === '{' && stack.at(-2) === '['
      && repaired.trimEnd().endsWith(',')) {
      // A common truncation drops the item object's final `}` immediately
      // before the next object in an array. Close only that one object when
      // the surrounding array makes the repair unambiguous.
      const commaIndex = repaired.trimEnd().length - 1;
      repaired = `${repaired.slice(0, commaIndex)}}${repaired.slice(commaIndex)}`;
      popContainer();
      insertedClosers = true;
    }
    if (character === '{' || character === '[') { pushContainer(character); repaired += character; continue; }
    if (character === '}' || character === ']') {
      const expected = character === '}' ? '{' : '[';
      const target = stack.lastIndexOf(expected);
      if (target < 0) return undefined;
      while (stack.length - 1 > target) {
        repaired += popContainer() === '{' ? '}' : ']';
        insertedClosers = true;
      }
      popContainer();
      repaired += character;
      continue;
    }
    repaired += character;
  }
  if (inString) return undefined;
  const trimmed = repaired.trimEnd();
  if (!trimmed || /[,:{\[]$/.test(trimmed)) return undefined;
  if (!stack.length) return insertedClosers ? trimmed : undefined;
  return trimmed + [...stack].reverse().map((opening) => opening === '{' ? '}' : ']').join('');
}

function looksLikeObjectProperty(value: string, start: number): boolean {
  return /^\s*"(?:[^"\\]|\\.)*"\s*:/u.test(value.slice(start));
}

function parseNestedJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeOperator(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const left = Object.hasOwn(record, 'left') ? normalizeOperator(record.left) : record.left;
  const right = Object.hasOwn(record, 'right') ? normalizeOperator(record.right) : record.right;
  if (['add', 'subtract', 'multiply', 'divide'].includes(String(record.kind))
    && Object.hasOwn(record, 'left') && Object.hasOwn(record, 'right')) {
    return { ...record, kind: 'arithmetic', operation: record.kind, left, right };
  }
  if (left !== record.left || right !== record.right) return { ...record, left, right };
  return value;
}

function branchInput(
  value: unknown,
  candidate: unknown,
  branch: Schema,
  definitions: Record<string, Schema>,
): unknown {
  return typeof value === 'string' && containsStringBranch(branch, definitions) ? value : candidate;
}

function containsStringBranch(schema: Schema, definitions: Record<string, Schema>): boolean {
  if (schema.type === 'string') return true;
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
    const definition = definitions[schema.$ref.slice('#/$defs/'.length)];
    return definition ? containsStringBranch(definition, definitions) : false;
  }
  for (const key of ['oneOf', 'anyOf']) {
    const branches = schema[key];
    if (Array.isArray(branches) && branches.some((item) => (
      !!item && typeof item === 'object' && !Array.isArray(item)
        && containsStringBranch(item as Schema, definitions)
    ))) return true;
  }
  return false;
}

function embeddedSchema(description: unknown): Schema | undefined {
  if (typeof description !== 'string') return undefined;
  const marker = 'Decoded value must satisfy: ';
  const start = description.indexOf(marker);
  if (start < 0) return undefined;
  try {
    const value = JSON.parse(description.slice(start + marker.length));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Schema : undefined;
  } catch {
    return undefined;
  }
}

function definitionsFromDescription(description: unknown): Record<string, Schema> {
  if (typeof description !== 'string') return {};
  const marker = 'these definitions: ';
  const start = description.indexOf(marker);
  if (start < 0) return {};
  try {
    const value = JSON.parse(description.slice(start + marker.length));
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, Schema> : {};
  } catch {
    return {};
  }
}

function selectBranch(options: unknown[], value: unknown, definitions: Record<string, Schema>): Schema | undefined {
  const branches = options.filter((candidate): candidate is Schema => (
    !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
  ));
  return matchingBranch(branches, value, definitions) ?? branches.find(branch => branch.type !== 'null');
}

function matchingBranch(options: unknown[], value: unknown, definitions: Record<string, Schema>): Schema | undefined {
  return options.filter((candidate): candidate is Schema => (
    !!candidate && typeof candidate === 'object' && !Array.isArray(candidate)
  )).find(branch => matchesBranch(branch, value, definitions));
}

function matchesBranch(schema: Schema, value: unknown, definitions: Record<string, Schema>): boolean {
  if (typeof schema.$ref === 'string' && schema.$ref.startsWith('#/$defs/')) {
    const definition = definitions[schema.$ref.slice('#/$defs/'.length)];
    return definition ? matchesBranch(definition, value, definitions) : false;
  }
  // Resolve nested unions against the original value first. A union may
  // contain a primitive string branch; parsing a JSON-looking string before
  // considering that branch would incorrectly turn ordinary text such as
  // command argsJson into an object.
  if (Array.isArray(schema.oneOf)) return schema.oneOf.some(branch => (
    !!branch && typeof branch === 'object' && matchesBranch(branch as Schema, value, definitions)
  ));
  if (Array.isArray(schema.anyOf)) return schema.anyOf.some(branch => (
    !!branch && typeof branch === 'object' && matchesBranch(branch as Schema, value, definitions)
  ));
  // A primitive string branch owns ordinary text even when its contents look
  // like JSON (for example the command transport's argsJson field).
  if (schema.type === 'string' && typeof value === 'string') return true;
  const parsed = parseNestedJson(value);
  if (parsed !== value) return matchesBranch(schema, parsed, definitions);
  if (schema.enum && Array.isArray(schema.enum)) return schema.enum.some(item => Object.is(item, value));
  if (schema.type === 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
    const properties = schema.properties as Record<string, Schema> | undefined;
    const record = value as Record<string, unknown>;
    if (properties?.kind?.enum && Array.isArray(properties.kind.enum)) {
      if (!properties.kind.enum.some(item => Object.is(item, record.kind))) return false;
      const required = Array.isArray(schema.required) ? schema.required as string[] : [];
      if (required.some(key => !Object.hasOwn(record, key))) return false;
      if (record.kind === 'arithmetic' && properties.left && properties.right) {
        return matchesBranch(properties.left, record.left, definitions)
          && matchesBranch(properties.right, record.right, definitions);
      }
      return true;
    }
    const required = Array.isArray(schema.required) ? schema.required as string[] : [];
    return required.length > 0 && required.every(key => Object.hasOwn(record, key));
  }
  return schema.type === 'string' ? typeof value === 'string'
    : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : schema.type === 'integer' ? typeof value === 'number' && Number.isInteger(value)
        : schema.type === 'boolean' ? typeof value === 'boolean' : schema.type === 'null' ? value === null : false;
}

function isOptionalWireValue(schema: Schema): boolean {
  return typeof schema.description === 'string'
    && schema.description.includes('optional field is absent')
    && Array.isArray(schema.anyOf) && schema.anyOf.some((candidate) => (
    !!candidate && typeof candidate === 'object' && (candidate as Schema).type === 'null'
  ));
}
