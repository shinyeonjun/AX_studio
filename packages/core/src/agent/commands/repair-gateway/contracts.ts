import type { AxCommand, AxCommandIssue, AxCommandResult } from '../schema.js';

export type RepairCommandResult = [AxCommandResult['status'], unknown, AxCommandIssue[]?];

export interface RepairCommandGateway {
  list(command: AxCommand): RepairCommandResult;
  inspect(command: AxCommand): RepairCommandResult;
  apply(command: AxCommand): RepairCommandResult;
  reject(command: AxCommand): RepairCommandResult;
}

export interface RepairGatewayOptions {
  snapshotRoot?: string;
}
