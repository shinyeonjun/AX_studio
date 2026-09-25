import type { DecisionInstruction } from '../../../../contracts/decision.js';
import { availableCapabilities } from '../../../../catalog/capability-graph.js';
import type { ConnectorCapability } from '../../../../catalog/capability-types.js';
import { TriggerSchema, type Trigger } from '../../../../workflow/schema.js';
import { boundDecisionString } from '../../../decision/context.js';

export interface JevWorkflowTriggerHint {
  key: string;
  capability: ConnectorCapability;
  trigger: Trigger;
}

// These are the trigger targets the job-proposal host can currently resolve; webhook path selection is not wired here.
const PROPOSABLE_EVENT_TRIGGERS = new Set<string>([
  'gmail.new_message',
  'slack.new_message',
  'local_folder.new_file',
]);

export function selectJevWorkflowTriggerHints(
  connectedConnectors: readonly string[],
  capabilities: readonly ConnectorCapability[] = availableCapabilities([...connectedConnectors]),
): JevWorkflowTriggerHint[] {
  return capabilities
    .filter((capability) => capability.kind === 'trigger'
      && PROPOSABLE_EVENT_TRIGGERS.has(capability.id))
    .flatMap((capability, index) => {
      const requiredParams = Object.fromEntries(
        capability.params.filter((param) => param.required).map((param) => [param.name, '']),
      );
      const parsed = TriggerSchema.safeParse({ type: capability.id, ...requiredParams });
      return parsed.success
        ? [{ key: `trigger_${index}`, capability, trigger: parsed.data }]
        : [];
    });
}

export function jevWorkflowTriggerCriteria(
  hints: readonly JevWorkflowTriggerHint[],
): Record<string, DecisionInstruction> {
  // Trigger selection and target policy live once in the workflow_trigger question.
  return Object.fromEntries(hints.map(({ key, capability, trigger }) => [key, {
    trigger_type: boundDecisionString(trigger.type, 128),
    connector: boundDecisionString(capability.connector, 128),
    label: boundDecisionString(capability.label, 120),
    what: boundDecisionString(capability.description, 240),
    required_parameters: capability.params
      .filter((param) => param.required)
      .map((param) => boundDecisionString(param.label, 120)),
    available_outputs: Object.fromEntries(
      Object.entries(capability.io?.outputs ?? {}).slice(0, 16).map(([port, contract]) => [
        boundDecisionString(port, 80),
        boundDecisionString(contract, 80),
      ]),
    ),
  }]));
}
