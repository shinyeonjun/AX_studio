import type { ContractTypeName } from '../../../contracts/capability-io.js';

export interface AvailableOutput {
  from: 'trigger' | string;
  port: string;
  type: ContractTypeName;
}
