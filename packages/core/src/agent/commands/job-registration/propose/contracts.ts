import type {
  AxCommandIssue,
  AxCommandResult,
} from '../../schema.js';
import type {
  AxJobProposeArgs,
  NormalizedJobSpec,
} from '../contract.js';

export type ProposeResponse = [
  AxCommandResult['status'],
  unknown,
  AxCommandIssue[]?,
];

export interface ValidatedProposeInput {
  data: AxJobProposeArgs;
  sessionId: string;
  path: string;
  channel: string;
  cron: string;
  timezone: string;
}

export interface PendingProposeJob {
  spec: NormalizedJobSpec;
}
