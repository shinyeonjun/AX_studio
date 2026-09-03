export const OUTPUT_CONTRACT_FAILURE_CODES = [
  'source_unavailable',
  'schema_column_missing',
  'schema_type_changed',
  'output_section_missing',
  'output_type_changed',
  'output_volume_anomaly',
] as const;

export type OutputContractIssueCode = (typeof OUTPUT_CONTRACT_FAILURE_CODES)[number];

/** A safe, payload-free explanation suitable for persisted execution logs. */
export interface OutputContractIssue {
  code: OutputContractIssueCode;
  path: string;
  message: string;
  expected?: string;
  actual?: string;
}

export type ContractCheckResult =
  | { ok: true; issues: [] }
  | { ok: false; issues: OutputContractIssue[] };

export interface ContractFailureData {
  phase: string;
  issues: OutputContractIssue[];
}

export type ContractFailure = Error & {
  code: 'input_schema_drift' | 'output_contract_failed';
  data: ContractFailureData;
};
