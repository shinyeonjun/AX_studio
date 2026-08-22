import { z } from 'zod';
import { MAX_WORKFLOW_SERIALIZED_CHARS, MAX_WORKFLOW_STEPS } from '../../workflow/schema.js';
import { InterviewDraftSchema, WorkflowNodeSchema, type InterviewDraft } from '../draft/schema.js';

export const MAX_AGENT_PATCH_OPERATIONS = 200;
export const MAX_AGENT_PATCH_CHARS = 200_000;

const DraftMetaSchema = z
  .object({
    name: z.string().max(500).optional(),
    goal: z.string().max(8_000).optional(),
    triggerType: InterviewDraftSchema.shape.triggerType,
    triggerFilter: InterviewDraftSchema.shape.triggerFilter,
    schedule: z.string().max(500).optional(),
    timezone: z.string().max(100).optional(),
    runAt: z.string().max(200).optional(),
    gmailAccount: z.string().max(500).optional(),
    slackChannel: z.string().max(500).optional(),
    localFolderId: z.string().max(500).optional(),
    localFolderPath: z.string().max(4_000).optional(),
    localFolderExtensions: z.string().max(500).optional(),
    success: z.string().max(4_000).optional(),
    assumptions: z.array(z.string().max(2_000)).max(MAX_WORKFLOW_STEPS).optional(),
  })
  .strict();

export const WorkflowDraftPatchSchema = z.object({
  /** Optimistic-concurrency token. The session revision is authoritative. */
  baseRevision: z.number().int().min(0).optional(),
  /** Existing slot contract; dynamic node slots remain code-owned. */
  set: z.record(z.unknown()).default({}),
  /** Add or replace graph nodes. Catalog sideEffect is never accepted from the patch. */
  upsertNodes: z.array(WorkflowNodeSchema).max(MAX_WORKFLOW_STEPS).default([]),
  removeNodeIds: z.array(z.string().min(1).max(200)).max(MAX_WORKFLOW_STEPS).default([]),
  meta: DraftMetaSchema.optional(),
  message: z.string().max(2_000).default(''),
});

export type WorkflowDraftPatch = z.infer<typeof WorkflowDraftPatchSchema>;

function hasUnsafeObjectKey(value: unknown, depth = 0): boolean {
  if (depth > 12 || value == null || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some((entry) => hasUnsafeObjectKey(entry, depth + 1));
  return Object.entries(value).some(([key, child]) =>
    key === '__proto__' || key === 'prototype' || key === 'constructor'
      ? true
      : hasUnsafeObjectKey(child, depth + 1),
  );
}

/** Apply size and prototype-pollution guards after Zod has checked the shape. */
export function assertWorkflowDraftPatchBounded(patch: WorkflowDraftPatch): WorkflowDraftPatch {
  if (Object.keys(patch.set).length > MAX_AGENT_PATCH_OPERATIONS) {
    throw new Error(`too_many_workflow_patch_values:${MAX_AGENT_PATCH_OPERATIONS}`);
  }
  if (hasUnsafeObjectKey(patch)) {
    throw new Error('workflow_patch_unsafe_key');
  }
  const serialized = JSON.stringify(patch);
  if (serialized.length > MAX_AGENT_PATCH_CHARS) {
    throw new Error(`workflow_patch_too_large:${MAX_AGENT_PATCH_CHARS}`);
  }
  if (serialized.length > MAX_WORKFLOW_SERIALIZED_CHARS) {
    throw new Error('workflow_patch_exceeds_workflow_limit');
  }
  return patch;
}

export function parseWorkflowDraftPatch(value: unknown): WorkflowDraftPatch {
  if (hasUnsafeObjectKey(value)) throw new Error('workflow_patch_unsafe_key');
  return assertWorkflowDraftPatchBounded(WorkflowDraftPatchSchema.parse(value));
}
