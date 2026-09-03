import { stepsById } from '../control-flow.js';
import type { Step, WorkflowIR } from '../schema.js';
import {
  aiDecisionOutputPorts,
  stepOutputPorts,
  type AvailableOutput,
} from './ports.js';
import { inferActionBindings } from './infer-action.js';
import { inferAiBindings } from './infer-ai.js';

function mergeBranchAvailable(
  base: AvailableOutput[],
  thenAvailable: AvailableOutput[],
  elseAvailable: AvailableOutput[],
): AvailableOutput[] {
  const key = (item: AvailableOutput) => `${item.from}:${item.port}`;
  const baseKeys = new Set(base.map(key));
  const thenAdded = thenAvailable.filter((item) => !baseKeys.has(key(item)));
  const elseKeys = new Set(elseAvailable.map(key));
  const shared = thenAdded.filter((item) => elseKeys.has(key(item)));
  return [...base, ...shared];
}

function mergeGuaranteedSources(
  base: Set<string | 'trigger'>,
  thenSources: Set<string | 'trigger'>,
  elseSources: Set<string | 'trigger'>,
): Set<string | 'trigger'> {
  const sharedBranchSteps = [...thenSources].filter(
    (source) => source !== 'trigger' && elseSources.has(source),
  );
  return new Set([...base, ...sharedBranchSteps]);
}

function inferStepBindings(
  step: Step,
  available: AvailableOutput[],
  ir: WorkflowIR,
  guaranteedSources: Set<string | 'trigger'>,
): Step {
  if (step.type === 'ai_decision') return inferAiBindings(step, available, guaranteedSources);
  if (step.type === 'action') return inferActionBindings(step, available, ir, guaranteedSources);
  return step;
}

export function inferSequenceBindings(
  sequence: Step[],
  available: AvailableOutput[],
  guaranteedSources: Set<string | 'trigger'>,
  ir: WorkflowIR,
  allSteps: Step[],
  updated: Map<string, Step>,
): { available: AvailableOutput[]; guaranteedSources: Set<string | 'trigger'> } {
  let currentAvailable = [...available];
  let currentGuaranteed = new Set(guaranteedSources);

  for (const step of sequence) {
    if (step.type === 'if') {
      const thenResult = inferSequenceBindings(
        stepsById(allSteps, step.thenStepIds),
        currentAvailable,
        currentGuaranteed,
        ir,
        allSteps,
        updated,
      );
      const elseResult = inferSequenceBindings(
        stepsById(allSteps, step.elseStepIds ?? []),
        currentAvailable,
        currentGuaranteed,
        ir,
        allSteps,
        updated,
      );
      updated.set(step.id, step);
      currentAvailable = mergeBranchAvailable(currentAvailable, thenResult.available, elseResult.available);
      currentGuaranteed = mergeGuaranteedSources(
        currentGuaranteed,
        thenResult.guaranteedSources,
        elseResult.guaranteedSources,
      );
      continue;
    }

    const inferred = inferStepBindings(step, currentAvailable, ir, currentGuaranteed);
    updated.set(inferred.id, inferred);
    if (inferred.type === 'action') {
      currentAvailable.push(...stepOutputPorts(inferred));
      currentGuaranteed.add(inferred.id);
    } else if (inferred.type === 'ai_decision') {
      currentAvailable.push(...aiDecisionOutputPorts(inferred));
      currentGuaranteed.add(inferred.id);
    }
  }

  return { available: currentAvailable, guaranteedSources: currentGuaranteed };
}
