import type { ContractValidationIssue } from '../../../workflow/contract-validator.js';
import type {
  AxCommandIssue,
  AxCommandResult,
  AxInputRequest,
} from '../schema.js';

export function issue(
  code: string,
  message: string,
  path?: string,
  inputRequests?: AxInputRequest[],
): AxCommandIssue {
  return {
    code,
    message,
    ...(path ? { path } : {}),
    ...(inputRequests?.length ? { inputRequests } : {}),
  };
}

export function missingInput(
  inputRequests: AxInputRequest[],
  message: string,
  path: string,
): [AxCommandResult['status'], unknown, AxCommandIssue[]] {
  return [
    'needs_input',
    { message },
    [issue('missing_argument', message, path, inputRequests)],
  ];
}

export function mapContractIssue(entry: ContractValidationIssue): AxCommandIssue {
  return {
    code: entry.code,
    ...(entry.stepId ? { path: 'steps.' + entry.stepId } : {}),
    message: entry.message,
    ...(entry.expected ? { expected: entry.expected } : {}),
    ...(entry.available ? { available: entry.available } : {}),
    ...(entry.missingInputs?.length
      ? {
          inputRequests: entry.missingInputs.map((input, index) => ({
            id: 'ax-input-' + (entry.stepId ?? entry.code) + '-' + input.name + '-' + index,
            label: input.label,
            type: input.inputType ?? 'text',
            required: true,
            ...(input.placeholder ? { placeholder: input.placeholder } : {}),
            reason: input.question,
          })),
        }
      : {}),
  };
}
