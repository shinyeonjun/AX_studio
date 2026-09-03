import { linearSteps } from '../control-flow.js';
import type { Step, WorkflowIR } from '../schema.js';
import { triggerOutputPorts } from './ports.js';
import { inferSequenceBindings } from './infer-sequence.js';

export function inferWorkflowBindings(ir: WorkflowIR): WorkflowIR {
  // Binding inference follows the runtime sequence, including actions that
  // execute after an explicit approval node. Contract validation keeps using
  // linearContractSteps separately because an approval-gated action is not a
  // source before approval, but it still needs bindings when it resumes.
  const linear = linearSteps(ir.steps);
  const updated = new Map<string, Step>();
  inferSequenceBindings(
    linear,
    [...triggerOutputPorts(ir.trigger)],
    new Set(['trigger']),
    ir,
    ir.steps,
    updated,
  );
  return {
    ...ir,
    steps: ir.steps.map((step) => updated.get(step.id) ?? step),
  };
}
