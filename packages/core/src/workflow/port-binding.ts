import { z } from 'zod';

export const PortBindingSchema = z.object({
  from: z.union([z.literal('trigger'), z.string()]),
  output: z.string(),
});

export type PortBinding = z.infer<typeof PortBindingSchema>;

/** Reserved binding prefix used to pass additional transform snapshots. */
export const SNAPSHOT_BINDING_PREFIX = 'snapshot.';

export function snapshotBindingPort(sourceId: string): string {
  return `${SNAPSHOT_BINDING_PREFIX}${sourceId}`;
}

function parseBindingReference(value: string): PortBinding | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  const dot = trimmed.match(/^([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_.-]+)$/);
  if (!dot) return undefined;

  const [, from, output] = dot;
  if (!from || !output) return undefined;
  return from === 'trigger' ? { from: 'trigger', output } : { from, output };
}

/** Coerce the common string/ref shapes emitted by planning models. */
export function coercePortBinding(value: unknown): PortBinding | undefined {
  if (value == null) return undefined;

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value.trim());
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return coercePortBinding(parsed);
      }
    } catch {
      // Fall through to the compact step.output form.
    }
    return parseBindingReference(value);
  }

  if (typeof value !== 'object' || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record.ref === 'string') return parseBindingReference(record.ref);

  const fromRaw = record.from;
  const outputRaw = record.output;
  if (fromRaw != null && outputRaw != null) {
    const from = fromRaw === 'trigger' ? 'trigger' : String(fromRaw).trim();
    const output = String(outputRaw).trim();
    if (from && output) return { from, output };
  }

  return undefined;
}
