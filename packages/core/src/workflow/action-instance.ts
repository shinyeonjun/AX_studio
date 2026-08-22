import { z } from 'zod';
import { PortBindingSchema, coercePortBinding, type PortBinding } from './port-binding.js';

function parseJsonRecordValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

function parseBindingsRecord(value: unknown): unknown {
  if (value == null || value === '') return undefined;
  const parsed = parseJsonRecordValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;

  const normalized: Record<string, PortBinding> = {};
  for (const [port, binding] of Object.entries(parsed as Record<string, unknown>)) {
    const coerced = coercePortBinding(binding);
    if (coerced) normalized[port] = coerced;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export const ActionInstanceSchema = z.object({
  actionRef: z.string(),
  connector: z.string().optional(),
  action: z.string().optional(),
  params: z.preprocess(parseJsonRecordValue, z.record(z.unknown()).default({})),
  bindings: z.preprocess(parseBindingsRecord, z.record(PortBindingSchema).optional()),
});

export type ActionInstance = z.infer<typeof ActionInstanceSchema>;
