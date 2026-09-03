import type {
  AxCommand,
  AxCommandIssue,
  AxCommandResult,
} from '../schema.js';
import type { ListSlackChannels } from '../job-registration/contract.js';
import type { WorkflowIR } from '../../../workflow/schema.js';

export type AxWorkflowCommandResult = [
  AxCommandResult['status'],
  unknown,
  AxCommandIssue[]?,
];

export interface AxEnqueueOnceOptions {
  workspaceSessionId?: string;
  listSlackChannels?: ListSlackChannels;
}

export interface AxWorkflowCommandGateway {
  list(): unknown;
  inspect(command: AxCommand): AxWorkflowCommandResult;
  validate(command: AxCommand): AxWorkflowCommandResult;
  create(command: AxCommand): AxWorkflowCommandResult;
  update(command: AxCommand): AxWorkflowCommandResult;
  delete(command: AxCommand): AxWorkflowCommandResult;
  run(command: AxCommand): Promise<AxWorkflowCommandResult>;
  enqueueOnce(command: AxCommand, options?: AxEnqueueOnceOptions): Promise<AxWorkflowCommandResult>;
}

export interface WorkflowGatewayOptions {
  runWorkflow?: (workflowId: string) => Promise<unknown>;
  enqueueOnce?: (
    workflow: WorkflowIR,
    options?: { workspaceSessionId?: string },
  ) => Promise<unknown> | unknown;
}
