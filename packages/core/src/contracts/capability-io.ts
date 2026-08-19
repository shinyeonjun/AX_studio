import { z } from 'zod';

/** Named contract reference used in capability I/O definitions. */
export const ContractTypeNameSchema = z.enum([
  'FileRef',
  'FileCreatedEvent',
  'DocumentArtifact',
  'DocumentIngestInput',
  'TextArtifact',
  'TableArtifact',
  'JsonArtifact',
  'EmailMessageRef',
  'SlackChannelRef',
  'SlackMessageRef',
]);

export type ContractTypeName = z.infer<typeof ContractTypeNameSchema>;

export const CapabilityIOSchema = z.object({
  inputs: z.record(ContractTypeNameSchema).default({}),
  outputs: z.record(ContractTypeNameSchema).default({}),
});

export type CapabilityIO = z.infer<typeof CapabilityIOSchema>;

export const ModuleDefinitionSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  capabilities: z.array(z.string()).default([]),
  triggers: z.array(z.string()).default([]),
});

export type ModuleDefinition = z.infer<typeof ModuleDefinitionSchema>;
