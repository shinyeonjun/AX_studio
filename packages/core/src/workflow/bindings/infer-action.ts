import type { ContractTypeName } from '../../contracts/capability-io.js';
import { contractTypesCompatible } from '../../contracts/compatibility.js';
import { resolveCapability } from '../../catalog/capability-graph.js';
import type { Step, WorkflowIR } from '../schema.js';
import {
  findCompatibleSource,
  findPreferredTextSource,
  hasConcreteParamForPort,
  type AvailableOutput,
} from './ports.js';

export function inferActionBindings(
  step: Extract<Step, { type: 'action' }>,
  available: AvailableOutput[],
  ir: WorkflowIR,
  guaranteedSources: Set<string | 'trigger'>,
): Extract<Step, { type: 'action' }> {
  const cap = resolveCapability(step.connector, step.action);
  const inputPorts = cap?.io?.inputs ?? {};
  const bindings = { ...(step.bindings ?? {}) };

  for (const [inputPort, inputType] of Object.entries(inputPorts)) {
    // A folder event is the source of truth for the file being processed. This
    // also repairs workflows saved before document.ingest used FileRef params.
    if (ir.trigger?.type === 'local_folder.new_file' && inputPort === 'source') {
      const triggerSource = available.find(
        (candidate) =>
          candidate.from === 'trigger' &&
          contractTypesCompatible(candidate.type, inputType as ContractTypeName),
      );
      if (triggerSource) {
        bindings[inputPort] = { from: triggerSource.from, output: triggerSource.port };
        continue;
      }
    }

    if (bindings[inputPort] || hasConcreteParamForPort(step, inputPort)) continue;
    const source = cap?.notification === true && (inputPort === 'text' || inputPort === 'body')
      ? findPreferredTextSource(available, inputType as ContractTypeName)
      : findCompatibleSource(available, inputType as ContractTypeName);
    if (!source) continue;
    if (source.from !== 'trigger' && !guaranteedSources.has(source.from)) continue;
    bindings[inputPort] = { from: source.from, output: source.port };
  }

  return Object.keys(bindings).length > 0 ? { ...step, bindings } : step;
}
