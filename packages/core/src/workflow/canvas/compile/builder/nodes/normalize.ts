import type { WorkflowCanvasDraft, WorkflowCanvasDraftInput } from '../../../draft/schema.js';
import { WorkflowCanvasDraftSchema } from '../../../draft/schema.js';
import { normalizeDraftActions } from '../../../draft/actions.js';
import { normalizeDraftIfConditions } from '../../../draft/conditions.js';

export function normalizeDraft(draft: WorkflowCanvasDraftInput): WorkflowCanvasDraft {
  return normalizeDraftIfConditions(
    normalizeDraftActions(WorkflowCanvasDraftSchema.parse(draft)),
  );
}
