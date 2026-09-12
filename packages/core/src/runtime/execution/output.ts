import { parseExecutionOutput, type ExecutionOutput } from '../../contracts/execution-output.js';
import type { WorkflowIR } from '../../workflow/schema.js';

/** Only publish explicitly calculated fields, never input rows, tokens or all variables. */
export function collectExecutionOutput(
  ir: WorkflowIR,
  stepResults: Record<string, unknown>,
  outputPorts: Record<string, Record<string, unknown>> | undefined,
): ExecutionOutput | undefined {
  const fields: ExecutionOutput['fields'] = [];
  for (const step of ir.steps) {
    if (step.type !== 'action' || step.connector !== 'transform' || step.action !== 'evaluate') continue;
    // Inputs also occupy stepResults. A materialized port proves this action actually ran.
    if (!outputPorts || !Object.hasOwn(outputPorts, step.id)) continue;
    const result = stepResults[step.id];
    if (!result || typeof result !== 'object' || !('value' in result)) continue;
    const path = step.params.outputPath;
    if (typeof path !== 'string' || !path) continue;
    fields.push({ path, valueJson: JSON.stringify(result.value),
      ...(typeof step.params.outputLabel === 'string' ? { label: step.params.outputLabel } : {}),
    });
  }
  if (!fields.length) return undefined;
  const output = parseExecutionOutput(JSON.stringify({ version: 1, fields }));
  if (!output) throw Object.assign(new Error('계산 결과를 보존할 수 있는 크기 또는 형식이 아닙니다.'), {
    code: 'execution_output_invalid',
  });
  return output;
}
