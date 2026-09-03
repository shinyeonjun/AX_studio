import { z } from 'zod';

/**
 * AX commands are the model-facing boundary. They are intentionally narrower
 * than the storage and runtime APIs: an agent can request a domain operation,
 * but it cannot choose a database query, shell command, or connector method.
 */
export const AX_COMMAND_NAMES = [
  'command.list',
  'resource.list',
  'http.list',
  'source.list',
  'source.files.list',
  'source.file.read',
  'source.search',
  'session.source.list',
  'session.source.read',
  'capability.list',
  'capability.invoke',
  'capability.describe',
  'workflow.list',
  'workflow.inspect',
  'workflow.validate',
  'workflow.create',
  'workflow.update',
  'workflow.delete',
  'workflow.run',
  'execution.enqueue_once',
  'execution.explain',
  'repair.list',
  'repair.inspect',
  'repair.apply',
  'repair.reject',
  'job.propose',
  'job.commit',
  'context.update',
  'ui.present',
  'discovery.start',
  'discovery.inspect',
  'discovery.cancel',
  'discovery.retry',
  'discovery.answer',
  'discovery.publish',
] as const;

export type AxCommandName = (typeof AX_COMMAND_NAMES)[number];

export const AxCommandSchema = z.object({
  name: z.enum(AX_COMMAND_NAMES),
  args: z.record(z.unknown()).default({}),
});

export type AxCommand = z.infer<typeof AxCommandSchema>;

export const AxCommandLifecycleSchema = z.enum([
  'read',
  'present',
  'ephemeral',
  'workflow',
  'context',
  'run',
]);

export type AxCommandLifecycle = z.infer<typeof AxCommandLifecycleSchema>;

export interface AxCommandDefinition {
  name: AxCommandName;
  lifecycle: AxCommandLifecycle;
  description: string;
  args: Record<string, string>;
  mutates: boolean;
}

export function parseAxCommand(value: unknown): AxCommand {
  return AxCommandSchema.parse(value);
}
