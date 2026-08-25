import { z } from 'zod';
import { CapabilityIOSchema } from '../contracts/capability-io.js';

export const CapabilityRiskSchema = z.enum(['read', 'write', 'trigger']);

export const CapabilityParamSchema = z.object({
  name: z.string(),
  label: z.string(),
  question: z.string(),
  required: z.boolean().default(false),
});

export const ConnectorCapabilitySchema = z.object({
  id: z.string(),
  connector: z.string(),
  kind: z.enum(['read', 'write', 'trigger']),
  label: z.string(),
  description: z.string(),
  sideEffect: z.enum(['NONE', 'REVERSIBLE', 'EXTERNAL', 'EXTERNAL_HIGH']).optional(),
  /** Optional method contract for read capabilities whose runtime action is generic. */
  readMethods: z.array(z.string().min(1)).optional(),
  params: z.array(CapabilityParamSchema).default([]),
  io: CapabilityIOSchema.optional(),
});

export type CapabilityParam = z.infer<typeof CapabilityParamSchema>;
export type ConnectorCapability = z.infer<typeof ConnectorCapabilitySchema>;

export interface ConnectorConnection {
  connector: string;
  connected: boolean;
  config?: Record<string, unknown>;
}
